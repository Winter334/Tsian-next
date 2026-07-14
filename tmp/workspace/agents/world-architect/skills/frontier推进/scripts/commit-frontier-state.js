async function commitFrontierState(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('FRONTIER_STATE_INVALID', 'Commit input must be an object.');
    // 1. 读当前 frontier.json
    const frontier = await readJson(tsian, 'save/playthrough/frontier.json');
    if (!isRecord(frontier)) fail('FRONTIER_INVALID', 'frontier.json must be a JSON object.', { path: 'save/playthrough/frontier.json' });
    const currentSourceWindow = isRecord(frontier.sourceWindow) ? frontier.sourceWindow : { start: null, end: null };
    const currentEnd = typeof currentSourceWindow.end === 'number' ? currentSourceWindow.end : 0;
    // 2. 校验 sourceWindow 顺序推进
    if (!isRecord(input.sourceWindow)) fail('FRONTIER_WINDOW_INVALID', 'sourceWindow must be an object.');
    const newStart = normalizePositiveInt(input.sourceWindow.start, currentEnd + 1, currentEnd + 1, 999999);
    if (newStart !== currentEnd + 1) fail('FRONTIER_WINDOW_NOT_SEQUENTIAL', 'sourceWindow.start must equal current sourceWindow.end + 1.', { expected: currentEnd + 1, got: newStart });
    const newEnd = normalizePositiveInt(input.sourceWindow.end, newStart, newStart, 999999);
    // 3. 加载 source 校验章节路径
    const source = await loadSource(tsian);
    const knownPaths = new Set(source.chapters.map((chapter) => chapter.path));
    const chaptersRaw = Array.isArray(input.sourceWindow.chapters) ? input.sourceWindow.chapters : [];
    const chapters = chaptersRaw.map((chapter, index) => {
      if (!isRecord(chapter)) fail('FRONTIER_WINDOW_CHAPTER_INVALID', 'Window chapters must be objects.', { index });
      const path = normalizeString(chapter.path, 'FRONTIER_WINDOW_CHAPTER_PATH_REQUIRED', 'Window chapter path', 240);
      if (!knownPaths.has(path)) fail('FRONTIER_SOURCE_REF_UNKNOWN', 'Window chapter path is not in imported chapter index.', { path });
      return { index: normalizePositiveInt(chapter.index, index + 1, 1, 999999), title: typeof chapter.title === 'string' ? chapter.title.trim() : '', path };
    });
    // 4. 校验 timeline source 锚点
    const timelineRaw = Array.isArray(input.timelineAnchors) ? input.timelineAnchors : [];
    if (timelineRaw.length === 0) fail('FRONTIER_TIMELINE_ANCHORS_REQUIRED', 'At least one source anchor is required.');
    const existingTimeline = Array.isArray(frontier.timeline) ? frontier.timeline : [];
    const existingSourceAnchors = existingTimeline.filter(function (a) { return isRecord(a) && a.kind === 'source'; });
    const lastSourceOrder = existingSourceAnchors.length > 0 ? Math.max.apply(null, existingSourceAnchors.map(function (a) { return typeof a.order === 'number' ? a.order : 0; })) : 0;
    const newAnchors = [];
    let expectedOrder = lastSourceOrder;
    for (let i = 0; i < timelineRaw.length; i++) {
      const anchor = timelineRaw[i];
      if (!isRecord(anchor)) fail('FRONTIER_TIMELINE_ANCHOR_INVALID', 'Each timeline anchor must be an object.', { index: i });
      if (anchor.kind !== 'source') fail('FRONTIER_TIMELINE_ANCHOR_KIND_INVALID', 'commit_frontier_state only accepts source anchors.', { index: i, kind: anchor.kind });
      const order = normalizePositiveInt(anchor.order, expectedOrder + 1, 1, 999999);
      if (order <= lastSourceOrder) fail('FRONTIER_ORDER_NOT_INCREASING', 'Source anchor order must be strictly greater than last existing source anchor order.', { order: order, lastSourceOrder: lastSourceOrder });
      if (order <= expectedOrder) fail('FRONTIER_ORDER_NOT_SEQUENTIAL', 'Source anchor order must be strictly increasing within this commit.', { order: order, expected: expectedOrder + 1 });
      expectedOrder = order;
      const chapter = normalizePositiveInt(anchor.chapter, newStart, 1, 999999);
      if (chapter < newStart || chapter > newEnd) fail('FRONTIER_TIMELINE_CHAPTER_OUT_OF_WINDOW', 'Timeline anchor chapter must be within the new sourceWindow range.', { chapter: chapter, windowStart: newStart, windowEnd: newEnd });
      const time = normalizeString(anchor.time, 'FRONTIER_TIMELINE_TIME_REQUIRED', 'Timeline anchor time', 120);
      const label = normalizeString(anchor.label, 'FRONTIER_TIMELINE_LABEL_REQUIRED', 'Timeline anchor label', 120);
      newAnchors.push({ kind: 'source', order: order, chapter: chapter, time: time, label: label });
    }
    // 5. 校验 extractedThrough
    const extractedThrough = typeof input.extractedThrough === 'string' && input.extractedThrough.trim() ? input.extractedThrough.trim() : (chapters.length ? chapters[chapters.length - 1].path : null);
    if (extractedThrough && !knownPaths.has(extractedThrough)) fail('FRONTIER_SOURCE_REF_UNKNOWN', 'extractedThrough must point to an imported chapter file.', { extractedThrough });
    // 6. 合并 timeline（追加新 source 锚点到现有数组）
    const mergedTimeline = existingTimeline.concat(newAnchors);
    const notes = typeof frontier.notes === 'string' ? frontier.notes : '';
    const frontierFile = { sourceWindow: { start: newStart, end: newEnd, chapters: chapters }, extractedThrough: extractedThrough, timeline: mergedTimeline, notes: notes, updatedAt: new Date().toISOString(), updatedBy: 'world-architect' };
    const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/frontier.json', content: JSON.stringify(frontierFile, null, 2) + '\n', mediaType: 'application/json' });
    tsian.trace('frontier_state_committed', { windowStart: newStart, windowEnd: newEnd, extractedThrough: extractedThrough, newAnchors: newAnchors.length, lastSourceOrder: lastSourceOrder, maxSourceOrder: expectedOrder, write: file.path });
    return { status: 'ready', write: { path: file.path, size: file.content.length }, window: { start: newStart, end: newEnd }, newAnchors: newAnchors.length, lastSourceOrder: lastSourceOrder };
  } catch (error) {
    tsian.trace('frontier_state_commit_failed', { code: error && error.code || 'FRONTIER_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitFrontierState(input, tsian, signal);
