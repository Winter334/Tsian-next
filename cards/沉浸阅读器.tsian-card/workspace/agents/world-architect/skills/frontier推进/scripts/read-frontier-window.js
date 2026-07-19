async function readFrontierWindow(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    // 1. 读当前 frontier.json
    const frontier = await readJson(tsian, 'save/playthrough/frontier.json');
    if (!isRecord(frontier)) fail('FRONTIER_INVALID', 'frontier.json must be a JSON object.', { path: 'save/playthrough/frontier.json' });
    const sourceWindow = isRecord(frontier.sourceWindow) ? frontier.sourceWindow : { start: null, end: null };
    const currentEnd = typeof sourceWindow.end === 'number' ? sourceWindow.end : 0;
    // 2. 加载 source chapter index
    const source = await loadSource(tsian);
    const totalChapters = source.chapters.length;
    const nextStart = currentEnd + 1;
    if (nextStart > totalChapters) fail('FRONTIER_NO_MORE_CHAPTERS', 'No more chapters to read.', { currentEnd, totalChapters });
    const windowSize = 15;
    const nextEnd = Math.min(totalChapters, nextStart + windowSize - 1);
    // 3. 读窗口内章节文本
    const chapters = [];
    const parts = [];
    const cache = new Map();
    let totalCharacters = 0;
    const maxCharacters = 120000;
    for (const chapter of source.chapters.slice(nextStart - 1, nextEnd)) {
      signal.throwIfAborted();
      const content = await readSourceChapter(tsian, chapter, cache);
      const cleaned = cleanText(content);
      const remaining = maxCharacters - totalCharacters;
      if (remaining <= 0) break;
      const used = cleaned.length > remaining ? cleaned.slice(0, remaining) : cleaned;
      totalCharacters += used.length;
      chapters.push({ ...compactSourceChapter(chapter), charactersRead: used.length, truncated: used.length < cleaned.length });
      var body = used;
      var nl = body.indexOf('\n');
      var firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === chapter.title) { body = nl === -1 ? '' : body.slice(nl + 1).replace(/^\s+/, ''); }
      parts.push('# ' + chapter.title + '\n\n' + body);
      if (totalCharacters >= maxCharacters) break;
    }
    // 4. 提取现有 timeline source 锚点（供 order 赋值参考）
    const timeline = Array.isArray(frontier.timeline) ? frontier.timeline : [];
    const sourceAnchors = timeline.filter(function (a) { return isRecord(a) && a.kind === 'source'; });
    const lastSourceOrder = sourceAnchors.length > 0 ? Math.max.apply(null, sourceAnchors.map(function (a) { return typeof a.order === 'number' ? a.order : 0; })) : 0;
    const result = {
      window: { start: nextStart, end: chapters.length ? chapters[chapters.length - 1].index : nextStart, totalChapters: totalChapters, chapters: chapters },
      text: parts.join('\n\n'),
      frontierState: { sourceWindow: sourceWindow, lastSourceOrder: lastSourceOrder, timeline: timeline }
    };
    tsian.trace('frontier_window_read', { start: result.window.start, end: result.window.end, totalCharacters: totalCharacters, chapterCount: chapters.length, lastSourceOrder: lastSourceOrder });
    return result;
  } catch (error) {
    tsian.trace('frontier_window_read_failed', { code: error && error.code || 'FRONTIER_READ_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return readFrontierWindow(input, tsian, signal);
