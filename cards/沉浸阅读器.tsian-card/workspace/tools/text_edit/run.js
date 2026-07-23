const SAVE_PREFIX = 'save/';

function isRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}
function okError(code, message, details) {
  return { code: code, message: 'text_edit: ' + message, details: details || {} };
}
function fail(code, message, details) {
  throw okError(code, message, details);
}
function throwIfAborted(signal) {
  if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
}
function assertSafeTarget(target) {
  if (typeof target !== 'string' || !target.startsWith(SAVE_PREFIX) || target !== target.trim()) {
    fail('TEXT_EDIT_TARGET_INVALID', 'target must be a save/... path without surrounding whitespace.', { target: target });
  }
  if (target.includes('\0') || target.includes('\\')) fail('TEXT_EDIT_TARGET_INVALID', 'target must not contain NUL or backslashes.', { target: target });
  const parts = target.split('/');
  if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
    fail('TEXT_EDIT_TARGET_INVALID', 'target must not contain empty or traversal segments.', { target: target });
  }
}
function normalizeOps(input) {
  if (!isRecord(input)) fail('TEXT_EDIT_INPUT_INVALID', 'input must be an object.', { input: input });
  if (Object.prototype.hasOwnProperty.call(input, 'ops')) {
    if (!Array.isArray(input.ops) || input.ops.length === 0) fail('TEXT_EDIT_OPS_INVALID', 'ops must be a non-empty array.', { ops: input.ops });
    const otherKeys = Object.keys(input).filter(function (key) { return key !== 'ops'; });
    if (otherKeys.length > 0) fail('TEXT_EDIT_OPS_INVALID', 'ops cannot be combined with single-operation fields.', { keys: otherKeys });
    return input.ops;
  }
  return [input];
}
function validateOp(op, opIndex) {
  if (!isRecord(op)) fail('TEXT_EDIT_OP_INVALID', 'Each op must be an object.', { opIndex: opIndex });
  const allowed = new Set(['target', 'create', 'append', 'replace', 'remove']);
  const keys = Object.keys(op);
  for (const key of keys) {
    if (!allowed.has(key)) fail('TEXT_EDIT_OP_INVALID', 'Unknown op field.', { opIndex: opIndex, field: key });
  }
  if (!keys.some(function (key) { return key !== 'target'; })) fail('TEXT_EDIT_OP_EMPTY', 'Operation must include at least one edit field.', { opIndex: opIndex });
  assertSafeTarget(op.target);
  if (op.create !== undefined && typeof op.create !== 'string') fail('TEXT_EDIT_CREATE_INVALID', 'create must be a string.', { opIndex: opIndex });
  if (op.append !== undefined && (!Array.isArray(op.append) || op.append.some(function (line) { return typeof line !== 'string'; }))) {
    fail('TEXT_EDIT_APPEND_INVALID', 'append must be an array of strings.', { opIndex: opIndex });
  }
  if (op.replace !== undefined) {
    if (!Array.isArray(op.replace)) fail('TEXT_EDIT_REPLACE_INVALID', 'replace must be an array.', { opIndex: opIndex });
    for (let i = 0; i < op.replace.length; i++) {
      const entry = op.replace[i];
      if (!isRecord(entry) || typeof entry.find !== 'string' || !entry.find || typeof entry.line !== 'string') {
        fail('TEXT_EDIT_REPLACE_INVALID', 'replace entries must be {find,line} with a non-empty find.', { opIndex: opIndex, index: i });
      }
    }
  }
  if (op.remove !== undefined && (!Array.isArray(op.remove) || op.remove.some(function (find) { return typeof find !== 'string' || !find; }))) {
    fail('TEXT_EDIT_REMOVE_INVALID', 'remove must be an array of non-empty strings.', { opIndex: opIndex });
  }
}
function isNotFound(error) {
  return error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'FILE_NOT_FOUND');
}
async function readExistingText(tsian, path) {
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return null;
    return file.content;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
function splitLines(content) {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : '';
}
function findLine(lines, find, opIndex, action, index) {
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(find)) matches.push(i);
  }
  if (matches.length === 0) fail('TEXT_EDIT_FIND_NOT_FOUND', action + ' find matched no line.', { opIndex: opIndex, index: index, find: find });
  if (matches.length > 1) fail('TEXT_EDIT_FIND_AMBIGUOUS', action + ' find matched more than one line.', { opIndex: opIndex, index: index, find: find, matchCount: matches.length });
  return matches[0];
}
function applyTextEdits(content, op, opIndex) {
  const lines = splitLines(content);
  const changedLines = [];
  if (Array.isArray(op.replace)) {
    for (let i = 0; i < op.replace.length; i++) {
      const lineIndex = findLine(lines, op.replace[i].find, opIndex, 'replace', i);
      if (lines[lineIndex] !== op.replace[i].line) {
        lines[lineIndex] = op.replace[i].line;
        changedLines.push(lineIndex + 1);
      }
    }
  }
  if (Array.isArray(op.remove)) {
    for (let i = 0; i < op.remove.length; i++) {
      const lineIndex = findLine(lines, op.remove[i], opIndex, 'remove', i);
      lines.splice(lineIndex, 1);
      changedLines.push(lineIndex + 1);
    }
  }
  if (Array.isArray(op.append)) {
    for (let i = 0; i < op.append.length; i++) {
      lines.push(op.append[i]);
      changedLines.push(lines.length);
    }
  }
  return { content: joinLines(lines), changedLines: changedLines };
}
async function applyOneOp(op, opIndex, tsian, signal) {
  validateOp(op, opIndex);
  throwIfAborted(signal);
  const existing = await readExistingText(tsian, op.target);
  if (existing === null && op.create === undefined) fail('TEXT_EDIT_TARGET_NOT_FOUND', 'Target text file does not exist; pass create to create it.', { opIndex: opIndex, target: op.target });
  if (existing !== null && op.create !== undefined) fail('TEXT_EDIT_CREATE_EXISTS', 'Target text file already exists; create is only for missing files.', { opIndex: opIndex, target: op.target });
  const base = existing === null ? op.create : existing;
  const applied = applyTextEdits(base, op, opIndex);
  const changed = existing === null || applied.content !== base;
  if (changed) {
    throwIfAborted(signal);
    await tsian.workspace.write({
      scope: 'save-runtime',
      path: op.target,
      content: applied.content,
      mediaType: 'text/plain;charset=utf-8',
      expectedContent: existing === null ? undefined : existing,
    });
  }
  return {
    opIndex: opIndex,
    target: op.target,
    path: op.target,
    changed: changed,
    changedLines: changed ? applied.changedLines : [],
  };
}
async function textEdit(input, tsian, signal) {
  const ops = normalizeOps(input);
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    try {
      results.push(await applyOneOp(ops[i], i, tsian, signal));
    } catch (error) {
      if (error && typeof error.code === 'string' && error.message) {
        return { status: results.length ? 'partial_failed' : 'failed', results: results, error: Object.assign({ opIndex: i }, error) };
      }
      throw error;
    }
  }
  const result = { status: 'ok', results: results };
  tsian.trace('text_edit', { opCount: ops.length, changedCount: results.filter(function (item) { return item.changed; }).length });
  return result;
}
return textEdit(input, tsian, signal);
