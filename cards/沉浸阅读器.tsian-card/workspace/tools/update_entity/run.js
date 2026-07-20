const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SUPPORTED_OPERATORS = new Set(['$set', '$unset', '$append', '$upsert', '$remove']);

function isRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function fail(code, message, details) {
  const error = new Error('update_entity: ' + message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}
function throwIfAborted(signal) {
  if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
}
function displayPath(path) {
  return path.length ? path.join('.') : '<patch>';
}
function assertSafeKey(key, path) {
  if (DANGEROUS_KEYS.has(key)) {
    fail('UPDATE_ENTITY_DANGEROUS_KEY', 'Dangerous object key is not allowed.', {
      key: key,
      path: displayPath(path.concat(key)),
    });
  }
}
function validateJsonValue(value, path, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', 'JSON numbers must be finite.', { path: displayPath(path), value: value });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', 'Circular JSON values are not allowed.', { path: displayPath(path) });
    }
    ancestors.add(value);
    for (let i = 0; i < value.length; i++) validateJsonValue(value[i], path.concat(String(i)), ancestors);
    ancestors.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', 'Circular JSON values are not allowed.', { path: displayPath(path) });
    }
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      assertSafeKey(key, path);
      validateJsonValue(value[key], path.concat(key), ancestors);
    }
    ancestors.delete(value);
    return;
  }
  fail('UPDATE_ENTITY_PATCH_INVALID', 'Patch values must be valid JSON values.', {
    path: displayPath(path),
    valueType: typeof value,
  });
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
function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value: value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
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
function markChanged(changedPaths, path) {
  changedPaths.add(displayPath(path));
}
function ensureArrayTarget(exists, current, path, operator, missingIsEmpty) {
  if (!exists) return missingIsEmpty ? [] : null;
  if (!Array.isArray(current)) {
    fail('UPDATE_ENTITY_TYPE_CONFLICT', operator + ' requires an array target.', {
      path: displayPath(path),
      actualType: current === null ? 'null' : typeof current,
    });
  }
  return cloneJson(current);
}
function matchesObjectCondition(item, condition) {
  if (!isRecord(item)) return false;
  for (const key of Object.keys(condition)) {
    if (!hasOwn(item, key) || !deepEqual(item[key], condition[key])) return false;
  }
  return true;
}
function mergeRecord(base, overlay) {
  const merged = cloneJson(base);
  for (const key of Object.keys(overlay)) setOwn(merged, key, cloneJson(overlay[key]));
  return merged;
}
function applyOperator(exists, current, operator, operand, path, changedPaths) {
  if (operator === '$set') {
    validateJsonValue(operand, path.concat(operator), new Set());
    if (exists && deepEqual(current, operand)) return { exists: true, value: current, changed: false };
    markChanged(changedPaths, path);
    return { exists: true, value: cloneJson(operand), changed: true };
  }

  if (operator === '$unset') {
    if (operand !== true) {
      fail('UPDATE_ENTITY_PATCH_INVALID', '$unset must be exactly true.', { path: displayPath(path), value: operand });
    }
    if (!exists) return { exists: false, changed: false };
    markChanged(changedPaths, path);
    return { exists: false, changed: true };
  }

  if (operator === '$append') {
    if (!Array.isArray(operand)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', '$append must be an array.', { path: displayPath(path) });
    }
    validateJsonValue(operand, path.concat(operator), new Set());
    const next = ensureArrayTarget(exists, current, path, operator, true);
    let changed = false;
    for (const candidate of operand) {
      if (!next.some(function (item) { return deepEqual(item, candidate); })) {
        next.push(cloneJson(candidate));
        changed = true;
      }
    }
    if (!changed) return { exists: exists, value: current, changed: false };
    markChanged(changedPaths, path);
    return { exists: true, value: next, changed: true };
  }

  if (operator === '$upsert') {
    if (!Array.isArray(operand)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', '$upsert must be an array.', { path: displayPath(path) });
    }
    const instructions = [];
    for (let i = 0; i < operand.length; i++) {
      const instruction = operand[i];
      if (!isRecord(instruction)) {
        fail('UPDATE_ENTITY_PATCH_INVALID', 'Each $upsert entry must be an object.', { path: displayPath(path), index: i });
      }
      const keys = Object.keys(instruction);
      for (const key of keys) assertSafeKey(key, path.concat(operator, String(i)));
      if (keys.some(function (key) { return key !== 'match' && key !== 'value'; }) || !hasOwn(instruction, 'match') || !hasOwn(instruction, 'value')) {
        fail('UPDATE_ENTITY_PATCH_INVALID', 'Each $upsert entry must contain only match and value.', {
          path: displayPath(path),
          index: i,
          keys: keys,
        });
      }
      if (!isRecord(instruction.match) || Object.keys(instruction.match).length === 0) {
        fail('UPDATE_ENTITY_PATCH_INVALID', '$upsert match must be a non-empty object.', { path: displayPath(path), index: i });
      }
      if (!isRecord(instruction.value)) {
        fail('UPDATE_ENTITY_PATCH_INVALID', '$upsert value must be an object.', { path: displayPath(path), index: i });
      }
      validateJsonValue(instruction.match, path.concat(operator, String(i), 'match'), new Set());
      validateJsonValue(instruction.value, path.concat(operator, String(i), 'value'), new Set());
      instructions.push(instruction);
    }
    const next = ensureArrayTarget(exists, current, path, operator, true);
    let changed = false;
    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      const matches = [];
      for (let itemIndex = 0; itemIndex < next.length; itemIndex++) {
        if (matchesObjectCondition(next[itemIndex], instruction.match)) matches.push(itemIndex);
      }
      if (matches.length > 1) {
        fail('UPDATE_ENTITY_UPSERT_AMBIGUOUS', '$upsert match selected more than one array item.', {
          path: displayPath(path),
          instructionIndex: i,
          matchCount: matches.length,
        });
      }
      if (matches.length === 0) {
        next.push(mergeRecord(instruction.match, instruction.value));
        changed = true;
      } else {
        const itemIndex = matches[0];
        const merged = mergeRecord(next[itemIndex], instruction.value);
        if (!deepEqual(merged, next[itemIndex])) {
          next[itemIndex] = merged;
          changed = true;
        }
      }
    }
    if (!changed || (exists && deepEqual(next, current))) {
      return { exists: exists, value: current, changed: false };
    }
    markChanged(changedPaths, path);
    return { exists: true, value: next, changed: true };
  }

  if (operator === '$remove') {
    if (!Array.isArray(operand)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', '$remove must be an array.', { path: displayPath(path) });
    }
    const conditions = [];
    for (let i = 0; i < operand.length; i++) {
      const condition = operand[i];
      const primitive = condition === null || typeof condition === 'string' || typeof condition === 'boolean' || typeof condition === 'number';
      if (!primitive && !isRecord(condition)) {
        fail('UPDATE_ENTITY_PATCH_INVALID', '$remove entries must be JSON scalars or non-empty objects.', {
          path: displayPath(path),
          index: i,
        });
      }
      if (isRecord(condition) && Object.keys(condition).length === 0) {
        fail('UPDATE_ENTITY_PATCH_INVALID', '$remove object conditions must not be empty.', { path: displayPath(path), index: i });
      }
      validateJsonValue(condition, path.concat(operator, String(i)), new Set());
      conditions.push(condition);
    }
    const source = ensureArrayTarget(exists, current, path, operator, false);
    if (source === null) return { exists: false, changed: false };
    const next = source.filter(function (item) {
      return !conditions.some(function (condition) {
        return isRecord(condition) ? matchesObjectCondition(item, condition) : deepEqual(item, condition);
      });
    });
    if (next.length === source.length) return { exists: true, value: current, changed: false };
    markChanged(changedPaths, path);
    return { exists: true, value: next, changed: true };
  }

  fail('UPDATE_ENTITY_PATCH_INVALID', 'Unknown patch operator.', { operator: operator, path: displayPath(path) });
}
function applyFieldPatch(exists, current, patchNode, path, changedPaths) {
  if (Array.isArray(patchNode)) {
    fail('UPDATE_ENTITY_PATCH_INVALID', 'Bare arrays are not valid patches; use $set, $append, $upsert, or $remove.', {
      path: displayPath(path),
    });
  }
  if (patchNode === null || typeof patchNode === 'string' || typeof patchNode === 'boolean' || typeof patchNode === 'number') {
    validateJsonValue(patchNode, path, new Set());
    if (exists && deepEqual(current, patchNode)) return { exists: true, value: current, changed: false };
    markChanged(changedPaths, path);
    return { exists: true, value: patchNode, changed: true };
  }
  if (!isRecord(patchNode)) {
    fail('UPDATE_ENTITY_PATCH_INVALID', 'Patch nodes must be JSON primitives or objects.', {
      path: displayPath(path),
      valueType: typeof patchNode,
    });
  }

  const keys = Object.keys(patchNode);
  for (const key of keys) assertSafeKey(key, path);
  const operatorKeys = keys.filter(function (key) { return key.startsWith('$'); });
  if (operatorKeys.length > 0) {
    if (keys.length !== 1 || operatorKeys.length !== 1) {
      fail('UPDATE_ENTITY_PATCH_INVALID', 'An operator object must contain exactly one operator and no ordinary fields.', {
        path: displayPath(path),
        keys: keys,
      });
    }
    const operator = operatorKeys[0];
    if (!SUPPORTED_OPERATORS.has(operator)) {
      fail('UPDATE_ENTITY_PATCH_INVALID', 'Unknown patch operator.', { path: displayPath(path), operator: operator });
    }
    return applyOperator(exists, current, operator, patchNode[operator], path, changedPaths);
  }

  if (exists && !isRecord(current)) {
    fail('UPDATE_ENTITY_TYPE_CONFLICT', 'Nested object patches require an object target; use $set to replace the field.', {
      path: displayPath(path),
      actualType: current === null ? 'null' : Array.isArray(current) ? 'array' : typeof current,
    });
  }
  const next = exists ? cloneJson(current) : {};
  let changed = false;
  for (const key of keys) {
    const childPath = path.concat(key);
    const childExists = hasOwn(next, key);
    const result = applyFieldPatch(childExists, childExists ? next[key] : undefined, patchNode[key], childPath, changedPaths);
    if (!result.changed) continue;
    changed = true;
    if (result.exists) setOwn(next, key, result.value);
    else delete next[key];
  }
  if (!changed) return { exists: exists, value: current, changed: false };
  return { exists: true, value: next, changed: true };
}
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref || ref !== ref.trim()) {
    fail('UPDATE_ENTITY_INVALID_REF', 'ref must be a non-empty string without surrounding whitespace.', { ref: ref });
  }
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail('UPDATE_ENTITY_INVALID_REF', 'ref must use exactly <type>:<localId>.', { ref: ref });
  }
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment === '.' || segment === '..' || /[\s/\\\0]/.test(segment)) {
      fail('UPDATE_ENTITY_INVALID_REF', 'ref segments must not contain whitespace, path separators, NUL, or traversal segments.', {
        ref: ref,
        segment: segment,
      });
    }
  }
  return {
    type: parts[0],
    localId: parts[1],
    path: 'save/entities/' + parts[0] + '/' + parts[1] + '.json',
  };
}
async function readEntity(tsian, ref, path, signal) {
  throwIfAborted(signal);
  let file;
  try {
    file = await tsian.workspace.read({ scope: 'save-runtime', path: path });
  } catch (error) {
    if (error && error.code === 'WORKSPACE_FILE_NOT_FOUND') {
      fail('UPDATE_ENTITY_NOT_FOUND', 'Entity file was not found.', { ref: ref, path: path });
    }
    throw error;
  }
  if (!file || typeof file.content !== 'string') {
    fail('UPDATE_ENTITY_NOT_FOUND', 'Entity file was not found.', { ref: ref, path: path });
  }
  let entity;
  try {
    entity = JSON.parse(file.content);
  } catch (error) {
    fail('UPDATE_ENTITY_JSON_INVALID', 'Entity file is not valid JSON.', {
      ref: ref,
      path: path,
      message: error && error.message || String(error),
    });
  }
  if (!isRecord(entity)) {
    fail('UPDATE_ENTITY_ENTITY_INVALID', 'Entity JSON root must be an object.', { ref: ref, path: path });
  }
  if (entity.id !== ref) {
    fail('UPDATE_ENTITY_ID_MISMATCH', 'Entity id does not match the requested ref.', {
      ref: ref,
      path: path,
      actualId: entity.id,
    });
  }
  return { content: file.content, entity: entity };
}
async function updateEntity(input, tsian, signal) {
  if (!isRecord(input)) {
    fail('UPDATE_ENTITY_INVALID_INPUT', 'input must be an object.', { input: input });
  }
  const parsedRef = parseRef(input.ref);
  if (!isRecord(input.patch)) {
    fail('UPDATE_ENTITY_PATCH_INVALID', 'patch must be an object.', { patch: input.patch });
  }
  const patchKeys = Object.keys(input.patch);
  for (const key of patchKeys) assertSafeKey(key, []);
  if (patchKeys.some(function (key) { return key.startsWith('$'); })) {
    fail('UPDATE_ENTITY_PATCH_INVALID', 'The root patch must contain entity field names, not an operator.', { keys: patchKeys });
  }
  if (hasOwn(input.patch, 'id')) {
    fail('UPDATE_ENTITY_ID_IMMUTABLE', 'The root id field cannot be changed or removed.', { ref: input.ref });
  }

  const original = await readEntity(tsian, input.ref, parsedRef.path, signal);
  const changedPaths = new Set();
  const applied = applyFieldPatch(true, cloneJson(original.entity), input.patch, [], changedPaths);
  const paths = Array.from(changedPaths);
  if (!applied.changed || deepEqual(original.entity, applied.value)) {
    const result = {
      status: 'unchanged',
      ref: input.ref,
      path: parsedRef.path,
      changed: false,
      changedPaths: [],
    };
    tsian.trace('update_entity', result);
    return result;
  }

  throwIfAborted(signal);
  await tsian.workspace.write({
    scope: 'save-runtime',
    path: parsedRef.path,
    content: JSON.stringify(applied.value, null, 2) + '\n',
    mediaType: 'application/json',
    expectedContent: original.content,
  });
  const result = {
    status: 'updated',
    ref: input.ref,
    path: parsedRef.path,
    changed: true,
    changedPaths: paths,
  };
  tsian.trace('update_entity', result);
  return result;
}
return updateEntity(input, tsian, signal);
