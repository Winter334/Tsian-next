const READING_BOOKMARK = 'save/agents/storyteller/source-bookmark.json';
async function sourcePosition(tsian, source, input) {
  let bookmark = null;
  if (input.startIndex === undefined) {
    let file;
    try { file = await tsian.workspace.read({ scope: 'effective', path: READING_BOOKMARK }); } catch (error) { if (error?.code !== 'WORKSPACE_FILE_NOT_FOUND') throw error; }
    if (file) bookmark = JSON.parse(file.content);
    if (bookmark?.importedAt !== source.manifest.importedAt) bookmark = null;
  }
  const startIndex = input.startIndex ?? bookmark?.startIndex ?? 1;
  const offset = input.offset ?? (input.startIndex === undefined ? bookmark?.offset : 0) ?? 0;
  if (!Number.isSafeInteger(startIndex) || startIndex < 1 || startIndex > source.chapters.length || !Number.isSafeInteger(offset) || offset < 0) fail('SOURCE_POSITION_INVALID', '章节或章内位置无效。');
  return { startIndex, offset };
}
async function readCanonSource(input, tsian, signal) {
  const source = await loadSource(tsian), position = await sourcePosition(tsian, source, input);
  const max = input.maxCharacters ?? 8000;
  if (!Number.isSafeInteger(max) || max < 500 || max > 12000) fail('SOURCE_LIMIT_INVALID', '原文读取长度应为 500–12000。');
  const chapters = [], parts = [], cache = new Map();
  let remaining = max, next = null;
  for (let i = position.startIndex - 1; i < source.chapters.length; i++) {
    signal.throwIfAborted();
    const chapter = source.chapters[i], body = await readSourceChapter(tsian, chapter, cache);
    const offset = i === position.startIndex - 1 ? position.offset : 0;
    if (offset > body.length) fail('SOURCE_POSITION_INVALID', '章内位置超过本章长度。');
    const text = body.slice(offset, offset + remaining), endOffset = offset + text.length;
    chapters.push({ index: i + 1, title: chapter.title, offset, endOffset, totalCharacters: body.length });
    parts.push('# ' + chapter.title + '\n' + text); remaining -= text.length;
    next = endOffset < body.length ? { startIndex: i + 1, offset: endOffset } : i + 1 < source.chapters.length ? { startIndex: i + 2, offset: 0 } : null;
    if (!remaining || chapters.length >= 20) break;
  }
  if (input.remember === true) await tsian.workspace.write({ scope: 'save-runtime', path: READING_BOOKMARK, content: JSON.stringify({ ...position, importedAt: source.manifest.importedAt }) });
  return { title: source.manifest.title, chapters, text: parts.join('\n\n'), truncated: next !== null, next };
}
async function locateCanonSource(input, tsian, signal) {
  const source = await loadSource(tsian), query = normalizeString(input.query, 'SOURCE_QUERY_INVALID', '检索词', 100);
  const startIndex = input.startIndex ?? 1, limit = input.chapterLimit ?? 20;
  if (!Number.isSafeInteger(startIndex) || startIndex < 1 || startIndex > source.chapters.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('SOURCE_POSITION_INVALID', '检索页位置无效。');
  const matches = [], cache = new Map(), end = Math.min(source.chapters.length, startIndex - 1 + limit);
  for (let i = startIndex - 1; i < end; i++) {
    signal.throwIfAborted();
    const chapter = source.chapters[i], body = await readSourceChapter(tsian, chapter, cache);
    const found = body.indexOf(query);
    if (chapter.title.includes(query) || found >= 0) {
      const offset = Math.max(0, found - 150);
      matches.push({ startIndex: i + 1, title: chapter.title, offset, preview: body.slice(offset, offset + 300) });
    }
    if (matches.length === 10) return { matches, nextStartIndex: i + 1 < source.chapters.length ? i + 2 : null };
  }
  return { matches, nextStartIndex: end < source.chapters.length ? end + 1 : null };
}
