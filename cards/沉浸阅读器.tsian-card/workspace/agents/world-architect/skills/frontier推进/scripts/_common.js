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
async function loadSource(tsian) {
  const manifest = await readJson(tsian, MANIFEST_PATH);
  const index = await readJson(tsian, CHAPTER_INDEX_PATH);
  if (!isRecord(manifest) || manifest.status !== 'ready') fail('OPENING_SOURCE_NOT_READY', 'Imported source manifest is not ready.', { path: MANIFEST_PATH });
  if (!isRecord(index) || !Array.isArray(index.chapters)) fail('OPENING_CHAPTER_INDEX_INVALID', 'Chapter index must contain chapters array.', { path: CHAPTER_INDEX_PATH });
  const chapters = index.chapters.map((chapter, index) => {
    if (!isRecord(chapter) || typeof chapter.path !== 'string') fail('OPENING_CHAPTER_INVALID', 'Each chapter must include a path.', { index });
    return { index: index + 1, title: typeof chapter.title === 'string' && chapter.title.trim() ? chapter.title.trim() : '第 ' + (index + 1) + ' 章', path: chapter.path, characters: typeof chapter.characters === 'number' ? chapter.characters : null };
  });
  return { manifest, chapters };
}
