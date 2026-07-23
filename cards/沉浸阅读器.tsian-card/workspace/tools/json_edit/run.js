const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAVE_PREFIX = 'save/';

function isRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function okError(code, message, details) {
  return { code: code, message: 'json_edit: ' + message, details: details || {} };
}
function fail(code, message, details) {
  throw okError(code, message, details);
}
function throwIfAborted(signal) {
  if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
}
function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) {
    const copy = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: cloneJson(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  }
  return value;
}
function deepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) return false;
    }
    return true;
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (key !== rightKeys[i] || !deepEqual(left[key], right[key])) return false;
  }
  return true;
}
function validateJsonValue(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('JSON_EDIT_VALUE_INVALID', 'JSON numbers must be finite.', { path: path.join('.'), value: value });
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail('JSON_EDIT_VALUE_INVALID', 'Circular JSON values are not allowed.', { path: path.join('.') });
    ancestors.add(value);
    for (let i = 0; i < value.length; i++) validateJsonValue(value[i], path.concat(String(i)), ancestors);
    ancestors.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) fail('JSON_EDIT_VALUE_INVALID', 'Circular JSON values are not allowed.', { path: path.join('.') });
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      assertSafeSegment(key, path.concat(key));
      validateJsonValue(value[key], path.concat(key), ancestors);
    }
    ancestors.delete(value);
    return;
  }
  fail('JSON_EDIT_VALUE_INVALID', 'Values must be valid JSON values.', { path: path.join('.'), valueType: typeof value });
}
function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value: value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
function assertSafeSegment(segment, path) {
  if (typeof segment !== 'string' || !segment || segment === '.' || segment === '..') {
    fail('JSON_EDIT_PATH_INVALID', 'Path segments must be non-empty and not traversal segments.', { path: path.join('.') });
  }
  if (DANGEROUS_KEYS.has(segment)) {
    fail('JSON_EDIT_PATH_INVALID', 'Dangerous object key is not allowed.', { path: path.join('.'), key: segment });
  }
  if (/[\/\0]/.test(segment)) {
    fail('JSON_EDIT_PATH_INVALID', 'Path segments must not contain path separators or NUL.', { path: path.join('.'), key: segment });
  }
}
function parseDotPath(path) {
  if (typeof path !== 'string' || !path.trim() || path !== path.trim()) {
    fail('JSON_EDIT_PATH_INVALID', 'Dot path must be a non-empty string without surrounding whitespace.', { path: path });
  }
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) assertSafeSegment(parts[i], parts.slice(0, i + 1));
  return parts;
}
function pathLabel(parts) {
  return parts.join('.');
}
function ensureParent(root, parts, changedPaths) {
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!hasOwn(current, key)) {
      setOwn(current, key, {});
      changedPaths.add(parts.slice(0, i + 1).join('.'));
    } else if (!isRecord(current[key])) {
      fail('JSON_EDIT_TYPE_CONFLICT', 'Intermediate path must be an object.', { path: parts.slice(0, i + 1).join('.'), actualType: Array.isArray(current[key]) ? 'array' : current[key] === null ? 'null' : typeof current[key] });
    }
    current = current[key];
  }
  return current;
}
function getAt(root, parts) {
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    if (!isRecord(current) && !Array.isArray(current)) return { exists: false };
    if (!hasOwn(current, parts[i])) return { exists: false };
    current = current[parts[i]];
  }
  return { exists: true, value: current };
}
function matchesCondition(item, condition) {
  if (isRecord(condition)) {
    if (!isRecord(item)) return false;
    for (const key of Object.keys(condition)) {
      if (!hasOwn(item, key) || !deepEqual(item[key], condition[key])) return false;
    }
    return true;
  }
  return deepEqual(item, condition);
}
function parseRef(target) {
  if (typeof target !== 'string') return null;
  const parts = target.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  for (const segment of parts) {
    if (segment === '.' || segment === '..' || /[\s/\\\0]/.test(segment)) return null;
  }
  return { type: parts[0], localId: parts[1] };
}
function assertSafeSavePath(path) {
  if (typeof path !== 'string' || !path.startsWith(SAVE_PREFIX) || path !== path.trim()) {
    fail('JSON_EDIT_TARGET_INVALID', 'Path target must be a save/... path without surrounding whitespace.', { target: path });
  }
  if (path.includes('\0') || path.includes('\\')) fail('JSON_EDIT_TARGET_INVALID', 'Path target must not contain NUL or backslashes.', { target: path });
  const parts = path.split('/');
  if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
    fail('JSON_EDIT_TARGET_INVALID', 'Path target must not contain empty or traversal segments.', { target: path });
  }
  if (!path.endsWith('.json')) fail('JSON_EDIT_TARGET_INVALID', 'json_edit target path must end with .json.', { target: path });
}
function resolveTarget(target) {
  if (typeof target !== 'string' || !target.trim()) fail('JSON_EDIT_TARGET_REQUIRED', 'target is required.', { target: target });
  if (target.startsWith(SAVE_PREFIX)) {
    assertSafeSavePath(target);
    return { target: target, path: target, ref: null, targetKind: inferPathKind(target) };
  }
  const ref = parseRef(target);
  if (!ref) fail('JSON_EDIT_TARGET_INVALID', 'target must be a <type>:<localId> ref or save/...json path.', { target: target });
  const path = ref.type === 'scene'
    ? 'save/scenes/' + ref.localId + '.json'
    : 'save/entities/' + ref.type + '/' + ref.localId + '.json';
  return { target: target, path: path, ref: ref.type + ':' + ref.localId, targetKind: ref.type === 'scene' ? 'scene' : 'entity' };
}
function inferPathKind(path) {
  if (/^save\/entities\/[^/]+\/[^/]+\.json$/.test(path)) return 'entity';
  if (/^save\/scenes\/[^/]+\.json$/.test(path)) return 'scene';
  if (/^save\/relationships\/character-[^/]+\.json$/.test(path)) return 'relationship';
  return 'json';
}
function expectedIdForPath(path) {
  let match = /^save\/entities\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (match) return match[1] + ':' + match[2];
  match = /^save\/scenes\/([^/]+)\.json$/.exec(path);
  if (match) return 'scene:' + match[1];
  return null;
}
function expectedSubjectForPath(path) {
  const match = /^save\/relationships\/character-([^/]+)\.json$/.exec(path);
  return match ? 'character:' + match[1] : null;
}
function validateAirpInvariants(path, json) {
  if (!isRecord(json)) fail('JSON_EDIT_ROOT_INVALID', 'JSON root must be an object.', { path: path });
  const expectedId = expectedIdForPath(path);
  if (expectedId) {
    if (!hasOwn(json, 'id')) fail('JSON_EDIT_ID_MISSING', 'Root id is required for entity and scene files.', { path: path, expected: expectedId });
    if (json.id !== expectedId) fail('JSON_EDIT_ID_MISMATCH', 'Root id does not match target path.', { path: path, expected: expectedId, actual: json.id });
  }
  const expectedSubject = expectedSubjectForPath(path);
  if (expectedSubject) {
    if (!hasOwn(json, 'subject')) fail('JSON_EDIT_SUBJECT_MISSING', 'Relationship subject is required.', { path: path, expected: expectedSubject });
    if (json.subject !== expectedSubject) {
      fail('JSON_EDIT_SUBJECT_MISMATCH', 'Relationship subject does not match target path.', { path: path, expected: expectedSubject, actual: json.subject });
    }
    if (Array.isArray(json.edges)) {
      for (let i = 0; i < json.edges.length; i++) {
        const edge = json.edges[i];
        if (!isRecord(edge)) continue;
        if (typeof edge.to !== 'string' || !/^character:[^\s/\\\0]+$/.test(edge.to)) {
          fail('JSON_EDIT_RELATIONSHIP_TO_INVALID', 'Relationship edges[].to must use character:<localId>.', { path: path, index: i, to: edge.to });
        }
      }
    }
  }
}
function normalizeOps(input) {
  if (!isRecord(input)) fail('JSON_EDIT_INPUT_INVALID', 'input must be an object.', { input: input });
  if (hasOwn(input, 'ops')) {
    if (!Array.isArray(input.ops) || input.ops.length === 0) fail('JSON_EDIT_OPS_INVALID', 'ops must be a non-empty array.', { ops: input.ops });
    const otherKeys = Object.keys(input).filter(function (key) { return key !== 'ops'; });
    if (otherKeys.length > 0) fail('JSON_EDIT_OPS_INVALID', 'ops cannot be combined with single-operation fields.', { keys: otherKeys });
    return input.ops;
  }
  return [input];
}
function validateOp(op, opIndex) {
  if (!isRecord(op)) fail('JSON_EDIT_OP_INVALID', 'Each op must be an object.', { opIndex: opIndex });
  const allowed = new Set(['target', 'create', 'set', 'append', 'upsert', 'remove', 'unset']);
  const keys = Object.keys(op);
  for (const key of keys) {
    if (!allowed.has(key)) fail('JSON_EDIT_OP_INVALID', 'Unknown op field.', { opIndex: opIndex, field: key });
  }
  if (!keys.some(function (key) { return key !== 'target'; })) fail('JSON_EDIT_OP_EMPTY', 'Operation must include at least one edit field.', { opIndex: opIndex });
}
function applySet(root, spec, changedPaths) {
  if (spec === undefined) return;
  if (!isRecord(spec)) fail('JSON_EDIT_SET_INVALID', 'set must be an object mapping dot paths to JSON values.', { set: spec });
  for (const path of Object.keys(spec)) {
    const parts = parseDotPath(path);
    validateJsonValue(spec[path], parts, new Set());
    const parent = ensureParent(root, parts, changedPaths);
    const key = parts[parts.length - 1];
    if (hasOwn(parent, key) && deepEqual(parent[key], spec[path])) continue;
    setOwn(parent, key, cloneJson(spec[path]));
    changedPaths.add(pathLabel(parts));
  }
}
function ensureArray(root, parts, createIfMissing, operator, changedPaths) {
  const parent = ensureParent(root, parts, changedPaths || new Set());
  const key = parts[parts.length - 1];
  if (!hasOwn(parent, key)) {
    if (!createIfMissing) fail('JSON_EDIT_ARRAY_MISSING', operator + ' target array does not exist.', { path: pathLabel(parts) });
    setOwn(parent, key, []);
    if (changedPaths) changedPaths.add(pathLabel(parts));
  }
  if (!Array.isArray(parent[key])) {
    fail('JSON_EDIT_TYPE_CONFLICT', operator + ' target must be an array.', { path: pathLabel(parts), actualType: parent[key] === null ? 'null' : typeof parent[key] });
  }
  return parent[key];
}
function applyAppend(root, spec, changedPaths, warnings) {
  if (spec === undefined) return;
  if (!isRecord(spec)) fail('JSON_EDIT_APPEND_INVALID', 'append must be an object mapping dot paths to arrays.', { append: spec });
  for (const path of Object.keys(spec)) {
    const parts = parseDotPath(path);
    const items = spec[path];
    if (!Array.isArray(items)) fail('JSON_EDIT_APPEND_INVALID', 'append values must be arrays.', { path: path });
    validateJsonValue(items, parts, new Set());
    const target = ensureArray(root, parts, true, 'append', changedPaths);
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      if (target.some(function (existing) { return deepEqual(existing, item); })) {
        skipped++;
      } else {
        target.push(cloneJson(item));
        added++;
      }
    }
    if (added > 0) changedPaths.add(pathLabel(parts));
    if (skipped > 0) warnings.push({ path: pathLabel(parts), skippedDuplicates: skipped });
  }
}
function normalizeUpsertEntry(entry, path, index) {
  if (!isRecord(entry)) fail('JSON_EDIT_UPSERT_INVALID', 'Each upsert entry must be an object.', { path: path, index: index });
  const keys = Object.keys(entry);
  for (const key of keys) {
    if (!['match', 'set', 'unset'].includes(key)) fail('JSON_EDIT_UPSERT_INVALID', 'Unknown upsert entry field.', { path: path, index: index, field: key });
  }
  if (!isRecord(entry.match) || Object.keys(entry.match).length === 0) fail('JSON_EDIT_UPSERT_INVALID', 'upsert match must be a non-empty object.', { path: path, index: index });
  const setValue = entry.set === undefined ? {} : entry.set;
  if (!isRecord(setValue)) fail('JSON_EDIT_UPSERT_INVALID', 'upsert set must be an object when present.', { path: path, index: index });
  const unsetValue = entry.unset === undefined ? [] : entry.unset;
  if (!Array.isArray(unsetValue) || unsetValue.some(function (item) { return typeof item !== 'string' || !item; })) {
    fail('JSON_EDIT_UPSERT_INVALID', 'upsert unset must be an array of top-level field names.', { path: path, index: index });
  }
  for (const key of Object.keys(entry.match)) assertSafeSegment(key, [path, 'match', key]);
  for (const key of Object.keys(setValue)) assertSafeSegment(key, [path, 'set', key]);
  for (const key of unsetValue) assertSafeSegment(key, [path, 'unset', key]);
  validateJsonValue(entry.match, [path, 'match'], new Set());
  validateJsonValue(setValue, [path, 'set'], new Set());
  return { match: entry.match, set: setValue, unset: unsetValue };
}
function applyUpsert(root, spec, changedPaths) {
  if (spec === undefined) return;
  if (!isRecord(spec)) fail('JSON_EDIT_UPSERT_INVALID', 'upsert must be an object mapping dot paths to instruction arrays.', { upsert: spec });
  for (const path of Object.keys(spec)) {
    const parts = parseDotPath(path);
    const entries = spec[path];
    if (!Array.isArray(entries)) fail('JSON_EDIT_UPSERT_INVALID', 'upsert values must be arrays.', { path: path });
    const target = ensureArray(root, parts, true, 'upsert', changedPaths);
    let changed = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = normalizeUpsertEntry(entries[i], path, i);
      const matches = [];
      for (let itemIndex = 0; itemIndex < target.length; itemIndex++) {
        if (matchesCondition(target[itemIndex], entry.match)) matches.push(itemIndex);
      }
      if (matches.length > 1) fail('JSON_EDIT_UPSERT_AMBIGUOUS', 'upsert match selected more than one array item.', { path: path, index: i, matchCount: matches.length });
      if (matches.length === 0) {
        target.push(Object.assign({}, cloneJson(entry.match), cloneJson(entry.set)));
        changed = true;
      } else {
        const itemIndex = matches[0];
        const current = isRecord(target[itemIndex]) ? cloneJson(target[itemIndex]) : {};
        for (const key of Object.keys(entry.set)) setOwn(current, key, cloneJson(entry.set[key]));
        for (const key of entry.unset) delete current[key];
        if (!deepEqual(current, target[itemIndex])) {
          target[itemIndex] = current;
          changed = true;
        }
      }
    }
    if (changed) changedPaths.add(pathLabel(parts));
  }
}
function applyRemove(root, spec, changedPaths) {
  if (spec === undefined) return;
  if (!isRecord(spec)) fail('JSON_EDIT_REMOVE_INVALID', 'remove must be an object mapping dot paths to condition arrays.', { remove: spec });
  for (const path of Object.keys(spec)) {
    const parts = parseDotPath(path);
    const conditions = spec[path];
    if (!Array.isArray(conditions)) fail('JSON_EDIT_REMOVE_INVALID', 'remove values must be arrays.', { path: path });
    validateJsonValue(conditions, parts, new Set());
    const target = ensureArray(root, parts, false, 'remove', changedPaths);
    let removed = false;
    for (let i = 0; i < conditions.length; i++) {
      const matches = [];
      for (let itemIndex = 0; itemIndex < target.length; itemIndex++) {
        if (matchesCondition(target[itemIndex], conditions[i])) matches.push(itemIndex);
      }
      if (matches.length === 0) fail('JSON_EDIT_REMOVE_NOT_FOUND', 'remove condition matched no array item.', { path: path, index: i });
      if (matches.length > 1) fail('JSON_EDIT_REMOVE_AMBIGUOUS', 'remove condition matched more than one array item.', { path: path, index: i, matchCount: matches.length });
      target.splice(matches[0], 1);
      removed = true;
    }
    if (removed) changedPaths.add(pathLabel(parts));
  }
}
function applyUnset(root, unset, changedPaths) {
  if (unset === undefined) return;
  if (!Array.isArray(unset)) fail('JSON_EDIT_UNSET_INVALID', 'unset must be an array of dot paths.', { unset: unset });
  for (const path of unset) {
    const parts = parseDotPath(path);
    const parentResult = getAt(root, parts.slice(0, -1));
    if (!parentResult.exists) continue;
    const parent = parentResult.value;
    const key = parts[parts.length - 1];
    if (!isRecord(parent) && !Array.isArray(parent)) continue;
    if (hasOwn(parent, key)) {
      delete parent[key];
      changedPaths.add(pathLabel(parts));
    }
  }
}
function applyEdits(base, op) {
  const next = cloneJson(base);
  const changedPaths = new Set();
  const warnings = [];
  applySet(next, op.set, changedPaths);
  applyAppend(next, op.append, changedPaths, warnings);
  applyUpsert(next, op.upsert, changedPaths);
  applyRemove(next, op.remove, changedPaths);
  applyUnset(next, op.unset, changedPaths);
  return { value: next, changedPaths: Array.from(changedPaths), warnings: warnings };
}
function isNotFound(error) {
  return error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'FILE_NOT_FOUND');
}
async function readExistingJson(tsian, path) {
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return null;
    let parsed;
    try {
      parsed = JSON.parse(file.content);
    } catch (error) {
      fail('JSON_EDIT_JSON_INVALID', 'Target file is not valid JSON.', { path: path, message: error && error.message || String(error) });
    }
    if (!isRecord(parsed)) fail('JSON_EDIT_ROOT_INVALID', 'JSON root must be an object.', { path: path });
    return { content: file.content, json: parsed };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
async function applyOneOp(op, opIndex, tsian, signal) {
  validateOp(op, opIndex);
  const resolved = resolveTarget(op.target);
  throwIfAborted(signal);
  const existing = await readExistingJson(tsian, resolved.path);
  if (!existing && op.create === undefined) fail('JSON_EDIT_TARGET_NOT_FOUND', 'Target JSON file does not exist; pass create to create it.', { opIndex: opIndex, target: op.target, path: resolved.path });
  if (existing && op.create !== undefined) fail('JSON_EDIT_CREATE_EXISTS', 'Target JSON file already exists; create is only for missing files.', { opIndex: opIndex, target: op.target, path: resolved.path });
  let base;
  if (existing) {
    base = existing.json;
  } else {
    if (!isRecord(op.create)) fail('JSON_EDIT_CREATE_INVALID', 'create must be a JSON object.', { opIndex: opIndex, target: op.target });
    validateJsonValue(op.create, ['create'], new Set());
    base = cloneJson(op.create);
  }
  const applied = applyEdits(base, op);
  validateAirpInvariants(resolved.path, applied.value);
  const changed = !existing || !deepEqual(base, applied.value);
  if (!changed) {
    return {
      opIndex: opIndex,
      target: op.target,
      path: resolved.path,
      targetKind: resolved.targetKind,
      changed: false,
      changedPaths: [],
      warnings: applied.warnings.length ? applied.warnings : undefined,
    };
  }
  throwIfAborted(signal);
  await tsian.workspace.write({
    scope: 'save-runtime',
    path: resolved.path,
    content: JSON.stringify(applied.value, null, 2) + '\n',
    mediaType: 'application/json',
    expectedContent: existing ? existing.content : undefined,
  });
  const result = {
    opIndex: opIndex,
    target: op.target,
    path: resolved.path,
    targetKind: resolved.targetKind,
    changed: true,
    changedPaths: applied.changedPaths,
  };
  if (applied.warnings.length) result.warnings = applied.warnings;
  return result;
}
async function jsonEdit(input, tsian, signal) {
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
  tsian.trace('json_edit', { opCount: ops.length, changedCount: results.filter(function (item) { return item.changed; }).length });
  return result;
}
return jsonEdit(input, tsian, signal);
