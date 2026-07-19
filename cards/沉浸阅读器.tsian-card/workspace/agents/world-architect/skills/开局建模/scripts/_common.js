const OPENING_SCHEMA = 'tsian.opening.initial-understanding.v1';
const MANIFEST_PATH = 'save/source/manifest.json';
const CHAPTER_INDEX_PATH = 'save/source/chapters.index.json';
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function parseJson(content, path) { try { return JSON.parse(content); } catch (error) { fail('OPENING_JSON_INVALID', path + ' is not valid JSON: ' + (error && error.message || error), { path }); } }
async function readJson(tsian, path) { const file = await tsian.workspace.read({ scope: 'effective', path }); if (!file || typeof file.content !== 'string') fail('OPENING_FILE_MISSING', 'Required file is missing.', { path }); return parseJson(file.content, path); }
async function readText(tsian, path) { const file = await tsian.workspace.read({ scope: 'effective', path }); if (!file || typeof file.content !== 'string') fail('OPENING_FILE_MISSING', 'Required file is missing.', { path }); return file.content; }
function cleanText(text) { return String(text || '').replace(/^#\s+.*\n+/, '').replace(/\n{3,}/g, '\n\n').trim(); }
function clipText(text, limit) { const cleaned = cleanText(text); return cleaned.length <= limit ? cleaned : cleaned.slice(0, limit).trimEnd() + '……'; }
function normalizePositiveInt(value, fallback, min, max) { const number = Number(value); if (!Number.isFinite(number)) return fallback; return Math.max(min, Math.min(max, Math.floor(number))); }
function pad4(value) { return String(value).padStart(4, '0'); }
function normalizeChapter(raw, arrayIndex) {
  if (!isRecord(raw)) fail('OPENING_CHAPTER_INVALID', 'Each chapter must be an object.', { index: arrayIndex });
  const index = normalizePositiveInt(raw.index, arrayIndex + 1, 1, 999999);
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '第 ' + index + ' 章';
  const characters = typeof raw.characters === 'number' && Number.isFinite(raw.characters) ? Math.max(0, Math.floor(raw.characters)) : null;
  if (isRecord(raw.source) && raw.source.kind === 'shard') {
    const source = raw.source;
    if (typeof source.path !== 'string' || !source.path.trim() || typeof source.start !== 'number' || typeof source.end !== 'number') fail('OPENING_CHAPTER_INVALID', 'Shard-backed chapter source is invalid.', { index: arrayIndex });
    const start = Math.max(0, Math.floor(source.start));
    const end = Math.max(0, Math.floor(source.end));
    if (end < start) fail('OPENING_CHAPTER_INVALID', 'Shard-backed chapter source end must be >= start.', { index: arrayIndex, start, end });
    const ref = typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : 'source:chapter-' + pad4(index);
    const shardId = typeof source.shardId === 'string' && source.shardId.trim() ? source.shardId.trim() : '';
    return { index, title, ref, characters, source: { kind: 'shard', shardId, path: source.path.trim(), start, end } };
  }
  if (typeof raw.path === 'string' && raw.path.trim()) {
    const path = raw.path.trim();
    return { index, title, ref: path, path, characters };
  }
  fail('OPENING_CHAPTER_INVALID', 'Each chapter must include shard source metadata or a legacy chapter reference.', { index: arrayIndex });
}
async function loadSource(tsian) {
  const manifest = await readJson(tsian, MANIFEST_PATH);
  const index = await readJson(tsian, CHAPTER_INDEX_PATH);
  if (!isRecord(manifest) || manifest.status !== 'ready') fail('OPENING_SOURCE_NOT_READY', 'Imported source manifest is not ready.', { path: MANIFEST_PATH });
  if (!isRecord(index) || !Array.isArray(index.chapters)) fail('OPENING_CHAPTER_INDEX_INVALID', 'Chapter index must contain chapters array.', { path: CHAPTER_INDEX_PATH });
  const chapters = index.chapters.map(normalizeChapter);
  return { manifest, chapterIndex: index, chapters };
}
function sourceRefForChapter(chapter) {
  if (!isRecord(chapter)) return null;
  if (typeof chapter.ref === 'string' && chapter.ref.trim()) return chapter.ref.trim();
  if (typeof chapter.path === 'string' && chapter.path.trim()) return chapter.path.trim();
  return null;
}
function compactSourceChapter(chapter) {
  const compact = { index: chapter.index, title: chapter.title };
  if (typeof chapter.characters === 'number') compact.characters = chapter.characters;
  if (isRecord(chapter.source) && typeof chapter.ref === 'string' && chapter.ref.trim()) compact.ref = chapter.ref.trim();
  else if (typeof chapter.path === 'string' && chapter.path.trim()) compact.path = chapter.path.trim();
  return compact;
}
async function readSourceChapter(tsian, chapter, cache) {
  if (isRecord(chapter.source) && chapter.source.kind === 'shard') {
    const path = chapter.source.path;
    let shard = cache.get(path);
    if (shard === undefined) {
      shard = await readText(tsian, path);
      cache.set(path, shard);
    }
    return shard.slice(chapter.source.start, chapter.source.end);
  }
  if (typeof chapter.path === 'string' && chapter.path.trim()) return readText(tsian, chapter.path.trim());
  fail('OPENING_CHAPTER_SOURCE_MISSING', 'Chapter index entry has no readable source reference.', { chapter: sourceRefForChapter(chapter), index: chapter && chapter.index });
}
async function readSourceChapterWindow(tsian, chapters) {
  const cache = new Map();
  const result = [];
  for (const chapter of chapters) result.push({ chapter, content: await readSourceChapter(tsian, chapter, cache) });
  return result;
}
