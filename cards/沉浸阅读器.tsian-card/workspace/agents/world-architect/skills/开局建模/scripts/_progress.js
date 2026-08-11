const OPENING_CONTROL_PATH = 'save/playthrough/opening-interview.json';
const OPENING_PROGRESS_PATH = 'save/playthrough/opening-progress.json';
const OPENING_CONTROL_SCHEMA = 'novel-airp.opening-interview.v1';
const OPENING_PROGRESS_SCHEMA = 'novel-airp.opening-progress.v1';
function progressText(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail('OPENING_PROGRESS_INVALID', label + ' must be a bounded non-empty string.', { label });
  return value.trim();
}
function progressInt(value, label, min) {
  if (!Number.isSafeInteger(value) || value < min) fail('OPENING_PROGRESS_INVALID', label + ' must be an integer >= ' + min + '.', { label, value });
  return value;
}
function assertProgressKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter(function (key) { return !allowedSet.has(key); });
  if (unknown.length) fail('OPENING_PROGRESS_INVALID', label + ' contains unsupported fields.', { label, fields: unknown });
}
async function readOptionalJson(tsian, path) {
  try { return await readJson(tsian, path); }
  catch (error) { if (error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'OPENING_FILE_MISSING')) return null; throw error; }
}
function normalizeOpeningControl(value) {
  if (!isRecord(value) || value.schema !== OPENING_CONTROL_SCHEMA || !isRecord(value.source) || !isRecord(value.session)) fail('OPENING_SESSION_MISMATCH', 'Opening control file is invalid.');
  const branch = value.branch === 'canon' || value.branch === 'original' ? value.branch : fail('OPENING_SESSION_MISMATCH', 'Opening branch is invalid.');
  return {
    value,
    sessionId: progressText(value.session.id, 'control.session.id', 80),
    sourceHash: progressText(value.source.hash, 'control.source.hash', 32),
    slot: progressText(value.session.slot, 'control.session.slot', 100),
    revision: progressInt(value.session.revision, 'control.session.revision', 0),
    branch,
  };
}
function emptyOpeningProgress(control) {
  return { schema: OPENING_PROGRESS_SCHEMA, sessionId: control.sessionId, sourceHash: control.sourceHash, branch: control.branch, revision: 0, processedAttemptId: '', readSlices: [], decisions: {}, unresolved: {}, phase: 'interviewing', updatedAt: new Date(0).toISOString() };
}
function normalizeStringMap(value, kind) {
  if (!isRecord(value) || Object.keys(value).length > 48) fail('OPENING_PROGRESS_INVALID', kind + ' must be a bounded object.');
  const output = {};
  for (const key of Object.keys(value)) {
    if (!key.trim() || key.length > 80 || !isRecord(value[key])) fail('OPENING_PROGRESS_INVALID', kind + ' entry is invalid.', { key });
    if (kind === 'decisions') {
      assertProgressKeys(value[key], ['value', 'evidenceRefs'], kind + '.' + key);
      const item = { value: progressText(value[key].value, kind + '.' + key + '.value', 800) };
      if (value[key].evidenceRefs !== undefined) {
        if (!Array.isArray(value[key].evidenceRefs) || value[key].evidenceRefs.length > 16) fail('OPENING_PROGRESS_INVALID', 'evidenceRefs must be a bounded array.', { key });
        item.evidenceRefs = Array.from(new Set(value[key].evidenceRefs.map(function (ref) { return progressText(ref, 'evidence ref', 240); })));
      }
      output[key] = item;
    } else {
      assertProgressKeys(value[key], ['reason'], kind + '.' + key);
      output[key] = { reason: progressText(value[key].reason, kind + '.' + key + '.reason', 800) };
    }
  }
  return output;
}
function normalizeReadSlices(value) {
  if (!Array.isArray(value) || value.length > 48) fail('OPENING_PROGRESS_INVALID', 'readSlices must be a bounded array.');
  const seen = new Set();
  return value.map(function (raw, index) {
    if (!isRecord(raw)) fail('OPENING_PROGRESS_INVALID', 'readSlices entry must be an object.', { index });
    assertProgressKeys(raw, ['ref', 'start', 'end', 'purpose'], 'readSlices[' + index + ']');
    const ref = progressText(raw.ref, 'readSlices.ref', 240);
    const purpose = progressText(raw.purpose, 'readSlices.purpose', 500);
    const start = raw.start === undefined ? undefined : progressInt(raw.start, 'readSlices.start', 0);
    const end = raw.end === undefined ? undefined : progressInt(raw.end, 'readSlices.end', 0);
    if ((start === undefined) !== (end === undefined)) fail('OPENING_PROGRESS_INVALID', 'readSlices start/end must both be present or both be omitted.', { index });
    if (start !== undefined && end !== undefined && end < start) fail('OPENING_PROGRESS_INVALID', 'readSlices end must be >= start.', { index });
    const key = ref + ':' + String(start === undefined ? '' : start) + ':' + String(end === undefined ? '' : end);
    if (seen.has(key)) fail('OPENING_PROGRESS_INVALID', 'readSlices entries must be unique.', { index, ref });
    seen.add(key);
    const item = { ref, purpose }; if (start !== undefined) item.start = start; if (end !== undefined) item.end = end; return item;
  });
}
function normalizeProtagonist(value, branch) {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.mode !== branch) fail('OPENING_PROGRESS_INVALID', 'protagonist must match the opening branch.');
  assertProgressKeys(value, ['mode', 'ref', 'name'], 'protagonist');
  const output = { mode: branch };
  if (value.ref !== undefined) output.ref = progressText(value.ref, 'protagonist.ref', 120);
  if (value.name !== undefined) output.name = progressText(value.name, 'protagonist.name', 120);
  return output;
}
function normalizeProgressSnapshot(value, control, revision, attemptId) {
  if (!isRecord(value)) fail('OPENING_PROGRESS_INVALID', 'next must be a complete progress snapshot.');
  assertProgressKeys(value, ['protagonist', 'decisions', 'unresolved', 'readSlices', 'phase'], 'next');
  const phase = value.phase === 'interviewing' || value.phase === 'ready-to-commit' ? value.phase : fail('OPENING_PROGRESS_PHASE_INVALID', 'advance_opening_progress phase must be interviewing or ready-to-commit.');
  const output = {
    schema: OPENING_PROGRESS_SCHEMA,
    sessionId: control.sessionId,
    sourceHash: control.sourceHash,
    branch: control.branch,
    revision,
    processedAttemptId: attemptId,
    readSlices: normalizeReadSlices(value.readSlices),
    decisions: normalizeStringMap(value.decisions, 'decisions'),
    unresolved: normalizeStringMap(value.unresolved, 'unresolved'),
    phase,
    updatedAt: new Date().toISOString(),
  };
  const protagonist = normalizeProtagonist(value.protagonist, control.branch); if (protagonist) output.protagonist = protagonist;
  return output;
}
function normalizeStoredOpeningProgress(value, control) {
  if (!isRecord(value)) fail('OPENING_PROGRESS_INVALID', 'Opening progress must be an object.');
  assertProgressKeys(value, ['schema', 'sessionId', 'sourceHash', 'branch', 'revision', 'processedAttemptId', 'protagonist', 'decisions', 'unresolved', 'readSlices', 'phase', 'updatedAt'], 'progress');
  if (value.schema !== OPENING_PROGRESS_SCHEMA) fail('OPENING_PROGRESS_INVALID', 'Opening progress schema is invalid.');
  const revision = progressInt(value.revision, 'progress.revision', 0);
  const processedAttemptId = typeof value.processedAttemptId === 'string' && value.processedAttemptId.length <= 100
    ? value.processedAttemptId
    : fail('OPENING_PROGRESS_INVALID', 'processedAttemptId must be a bounded string.');
  if ((revision === 0 && processedAttemptId !== '') || (revision > 0 && !processedAttemptId.trim())) {
    fail('OPENING_PROGRESS_INVALID', 'processedAttemptId must identify every applied revision.', { revision, processedAttemptId });
  }
  const phase = value.phase === 'interviewing' || value.phase === 'ready-to-commit' || value.phase === 'complete'
    ? value.phase
    : fail('OPENING_PROGRESS_PHASE_INVALID', 'Stored opening progress phase is invalid.');
  const output = {
    schema: OPENING_PROGRESS_SCHEMA,
    sessionId: progressText(value.sessionId, 'progress.sessionId', 80),
    sourceHash: progressText(value.sourceHash, 'progress.sourceHash', 32),
    branch: value.branch,
    revision,
    processedAttemptId,
    readSlices: normalizeReadSlices(value.readSlices),
    decisions: normalizeStringMap(value.decisions, 'decisions'),
    unresolved: normalizeStringMap(value.unresolved, 'unresolved'),
    phase,
    updatedAt: progressText(value.updatedAt, 'progress.updatedAt', 80),
  };
  if (output.branch !== 'canon' && output.branch !== 'original') fail('OPENING_PROGRESS_INVALID', 'Stored opening branch is invalid.');
  const protagonist = normalizeProtagonist(value.protagonist, output.branch); if (protagonist) output.protagonist = protagonist;
  assertProgressIdentity(output, control);
  return output;
}
function assertProgressIdentity(progress, control) {
  if (!isRecord(progress) || progress.schema !== OPENING_PROGRESS_SCHEMA || progress.sessionId !== control.sessionId || progress.sourceHash !== control.sourceHash || progress.branch !== control.branch || progress.revision !== control.revision) fail('OPENING_PROGRESS_CONFLICT', 'Opening progress identity/revision does not match control.', { controlRevision: control.revision, progressRevision: progress && progress.revision });
}
function assertProgressSourceRefs(progress, source) {
  const chaptersByRef = new Map();
  for (const chapter of source.chapters) {
    const ref = sourceRefForChapter(chapter);
    if (ref) chaptersByRef.set(ref, chapter);
  }
  for (const [index, slice] of progress.readSlices.entries()) {
    const chapter = chaptersByRef.get(slice.ref);
    if (!chapter) fail('OPENING_SOURCE_REF_UNKNOWN', 'readSlices ref is not in the imported source.', { index, ref: slice.ref });
    if (slice.end !== undefined && typeof chapter.characters === 'number' && slice.end > chapter.characters) {
      fail('OPENING_PROGRESS_INVALID', 'readSlices end exceeds the source chapter length.', { index, ref: slice.ref, end: slice.end, characters: chapter.characters });
    }
  }
  for (const [key, decision] of Object.entries(progress.decisions)) {
    for (const ref of decision.evidenceRefs || []) if (!chaptersByRef.has(ref)) fail('OPENING_SOURCE_REF_UNKNOWN', 'Decision evidence ref is not in the imported source.', { key, ref });
  }
}
function stableProgressValue(value) {
  if (Array.isArray(value)) return value.map(stableProgressValue);
  if (!isRecord(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = stableProgressValue(value[key]);
  return output;
}
function semanticProgress(value) {
  return JSON.stringify(stableProgressValue({ protagonist: value.protagonist || null, decisions: value.decisions, unresolved: value.unresolved, readSlices: value.readSlices, phase: value.phase }));
}
function assertProgressInheritance(previous, next) {
  if (previous.phase === 'complete') fail('OPENING_PROGRESS_PHASE_INVALID', 'Completed opening progress cannot be advanced.');
  if (previous.phase === 'ready-to-commit' && next.phase !== 'ready-to-commit') fail('OPENING_PROGRESS_PHASE_INVALID', 'ready-to-commit progress cannot return to interviewing.');
  if (previous.protagonist && !next.protagonist) fail('OPENING_PROGRESS_INHERITANCE_REQUIRED', 'Existing protagonist must be inherited or explicitly revised.');
  for (const key of Object.keys(previous.decisions || {})) if (!Object.prototype.hasOwnProperty.call(next.decisions, key)) fail('OPENING_PROGRESS_INHERITANCE_REQUIRED', 'Existing decisions must be inherited or explicitly revised under the same key.', { key });
  for (const key of Object.keys(previous.unresolved || {})) {
    if (!Object.prototype.hasOwnProperty.call(next.unresolved, key) && !Object.prototype.hasOwnProperty.call(next.decisions, key)) fail('OPENING_PROGRESS_INHERITANCE_REQUIRED', 'Resolved unresolved items must move to decisions under the same key.', { key });
  }
  const nextSlices = new Set(next.readSlices.map(function (slice) { return slice.ref + ':' + String(slice.start === undefined ? '' : slice.start) + ':' + String(slice.end === undefined ? '' : slice.end); }));
  for (const slice of previous.readSlices || []) {
    const key = slice.ref + ':' + String(slice.start === undefined ? '' : slice.start) + ':' + String(slice.end === undefined ? '' : slice.end);
    if (!nextSlices.has(key)) fail('OPENING_PROGRESS_INHERITANCE_REQUIRED', 'Existing readSlices must be inherited.', { ref: slice.ref });
  }
}
