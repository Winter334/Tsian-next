// read_entities: reads explicit entity refs and a deliberately bounded relationship graph.
const RELATIONSHIP_SCAN_LIMIT = 400;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function throwIfAborted(signal) {
  if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
}

function errorShape(code, message, details) {
  const result = { code: code, message: message };
  if (details !== undefined) result.details = details;
  return result;
}

function errorCode(error, fallback) {
  return error && typeof error.code === 'string' ? error.code : fallback;
}

function errorMessage(error, fallback) {
  return error && typeof error.message === 'string' ? error.message : fallback;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRef(value, field) {
  const ref = normalizeText(value);
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /[\s/\\\0]/.test(parts[0]) || /[\s/\\\0]/.test(parts[1]) || parts[0] === '.' || parts[0] === '..' || parts[1] === '.' || parts[1] === '..') {
    fail('READ_ENTITIES_INVALID_REF', (field || 'ref') + ' must use <type>:<localId> without whitespace or path separators.', { value: value });
  }
  return { ref: parts[0] + ':' + parts[1], type: parts[0], localId: parts[1] };
}

function entityPath(ref) {
  const parsed = parseRef(ref, 'entity ref');
  return 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
}

function relationshipPath(ref) {
  const parsed = parseRef(ref, 'entity ref');
  return parsed.type === 'character' ? 'save/relationships/character-' + parsed.localId + '.json' : null;
}

function uniqueRefs(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    fail('READ_ENTITIES_REFS_INVALID', 'refs must contain 1 to 20 entity refs.', { value: value });
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const ref = parseRef(value[index], 'refs entry').ref;
    if (!seen.has(ref)) {
      seen.add(ref);
      result.push(ref);
    }
  }
  return result;
}

function normalizeFieldPaths(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    fail('READ_ENTITIES_FIELDS_INVALID', 'fields must contain 1 to 30 field paths when present.', { value: value });
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const path = normalizeText(value[index]);
    const parts = path.split('.');
    if (!path || parts.some(function (part) { return !/^[A-Za-z0-9_\-\u4e00-\u9fff]+$/.test(part) || part === '__proto__' || part === 'constructor' || part === 'prototype'; })) {
      fail('READ_ENTITIES_FIELD_PATH_INVALID', 'fields entries must use safe dot paths.', { index: index, value: value[index] });
    }
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

function uniqueStrings(value, field, maxItems) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    fail('READ_ENTITIES_' + field.toUpperCase() + '_INVALID', field + ' has an invalid item count.', { value: value, maxItems: maxItems });
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const text = normalizeText(value[index]);
    if (!text) fail('READ_ENTITIES_' + field.toUpperCase() + '_INVALID', field + ' entries must be non-empty strings.', { index: index, value: value[index] });
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function normalizeRelations(value, rootCount) {
  if (value === undefined) return { direction: null, types: [], depth: 0, maxEntities: Math.max(rootCount, 12), maxEdges: 80 };
  if (!isRecord(value)) fail('READ_ENTITIES_RELATIONS_INVALID', 'relations must be an object when present.', { value: value });
  const rawDepth = value.depth === undefined ? 0 : Number(value.depth);
  if (!Number.isInteger(rawDepth) || rawDepth < 0 || rawDepth > 2) fail('READ_ENTITIES_RELATION_DEPTH_INVALID', 'relations.depth must be an integer from 0 to 2.', { value: value.depth });
  let direction = value.direction === undefined ? (rawDepth > 0 ? 'outgoing' : null) : normalizeText(value.direction);
  if (direction !== null && direction !== 'outgoing' && direction !== 'incoming' && direction !== 'both') {
    fail('READ_ENTITIES_RELATION_DIRECTION_INVALID', 'relations.direction must be outgoing, incoming, or both.', { value: value.direction });
  }
  if (rawDepth > 0 && !direction) direction = 'outgoing';
  const maxEntities = value.maxEntities === undefined ? Math.max(rootCount, 12) : Number(value.maxEntities);
  const maxEdges = value.maxEdges === undefined ? 80 : Number(value.maxEdges);
  if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > 30) fail('READ_ENTITIES_MAX_ENTITIES_INVALID', 'relations.maxEntities must be an integer from 1 to 30.', { value: value.maxEntities });
  if (maxEntities < rootCount) fail('READ_ENTITIES_MAX_ENTITIES_TOO_SMALL', 'relations.maxEntities must cover every explicit ref.', { maxEntities: maxEntities, refCount: rootCount });
  if (!Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > 240) fail('READ_ENTITIES_MAX_EDGES_INVALID', 'relations.maxEdges must be an integer from 1 to 240.', { value: value.maxEdges });
  return { direction: direction, types: uniqueStrings(value.types, 'relation_types', 20), depth: rawDepth, maxEntities: maxEntities, maxEdges: maxEdges };
}

function normalizeInput(input) {
  if (!isRecord(input)) fail('READ_ENTITIES_INPUT_INVALID', 'input must be an object.', { input: input });
  const refs = uniqueRefs(input.refs);
  return { refs: refs, fields: normalizeFieldPaths(input.fields), relations: normalizeRelations(input.relations, refs.length) };
}

async function readJson(tsian, path, signal, prefix) {
  throwIfAborted(signal);
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return { state: 'missing' };
    try {
      const json = JSON.parse(file.content);
      return isRecord(json) ? { state: 'ok', json: json } : { state: 'error', error: errorShape(prefix + '_JSON_SHAPE_INVALID', 'JSON document must be an object.', { path: path }) };
    } catch (error) {
      return { state: 'error', error: errorShape(prefix + '_JSON_INVALID', 'JSON document is invalid.', { path: path, message: errorMessage(error, 'JSON parse failed.') }) };
    }
  } catch (error) {
    if (error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'WORKSPACE_READ_NOT_FOUND' || error.code === 'FILE_NOT_FOUND')) return { state: 'missing' };
    return { state: 'error', error: errorShape(errorCode(error, prefix + '_READ_FAILED'), errorMessage(error, 'Workspace read failed.'), { path: path }) };
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function valueAtPath(source, path) {
  let current = source;
  for (const segment of path.split('.')) {
    if (!isRecord(current) && !Array.isArray(current)) return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

function assignAtPath(target, path, value) {
  const parts = path.split('.');
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!isRecord(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = cloneJson(value);
}

function projectEntity(entity, fields) {
  if (!fields) return cloneJson(entity);
  const projected = {};
  for (const field of fields) {
    const found = valueAtPath(entity, field);
    if (found.found) assignAtPath(projected, field, found.value);
  }
  return projected;
}

function edgeFromRaw(from, raw) {
  if (!isRecord(raw) || typeof raw.to !== 'string') return null;
  try {
    const to = parseRef(raw.to, 'relationship edge.to').ref;
    const edge = { from: from, to: to, type: normalizeText(raw.type) };
    if (Number.isFinite(raw.since)) edge.since = raw.since;
    if (Number.isFinite(raw.until)) edge.until = raw.until;
    if (typeof raw.note === 'string' && raw.note.trim()) edge.note = raw.note.trim();
    return edge;
  } catch (error) {
    return { invalid: true, error: errorShape(error.code || 'READ_ENTITIES_EDGE_INVALID', error.message || 'Relationship edge is invalid.', error.details) };
  }
}

async function readOutgoingEdges(tsian, ref, signal, errors) {
  const path = relationshipPath(ref);
  if (!path) return [];
  const result = await readJson(tsian, path, signal, 'READ_ENTITIES_RELATIONSHIP');
  if (result.state === 'missing') return [];
  if (result.state === 'error') {
    errors.push(Object.assign({}, result.error, { ref: ref, relationshipPath: path }));
    return [];
  }
  if (!Array.isArray(result.json.edges)) {
    errors.push(errorShape('READ_ENTITIES_RELATIONSHIP_EDGES_INVALID', 'Relationship document edges must be an array.', { ref: ref, path: path }));
    return [];
  }
  const edges = [];
  for (const raw of result.json.edges) {
    const edge = edgeFromRaw(ref, raw);
    if (!edge) continue;
    if (edge.invalid) {
      errors.push(Object.assign({}, edge.error, { ref: ref, relationshipPath: path }));
      continue;
    }
    edges.push(edge);
  }
  return edges;
}

async function buildIncomingIndex(tsian, signal, errors) {
  throwIfAborted(signal);
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/relationships/character-*.json', limit: RELATIONSHIP_SCAN_LIMIT });
  const paths = Array.isArray(result && result.matches) ? result.matches : [];
  const byTarget = new Map();
  for (const path of paths) {
    throwIfAborted(signal);
    const match = /^save\/relationships\/character-(.+)\.json$/.exec(path);
    if (!match) continue;
    const from = 'character:' + match[1];
    const loaded = await readJson(tsian, path, signal, 'READ_ENTITIES_RELATIONSHIP');
    if (loaded.state === 'missing') continue;
    if (loaded.state === 'error') {
      errors.push(Object.assign({}, loaded.error, { ref: from, relationshipPath: path }));
      continue;
    }
    if (!Array.isArray(loaded.json.edges)) {
      errors.push(errorShape('READ_ENTITIES_RELATIONSHIP_EDGES_INVALID', 'Relationship document edges must be an array.', { ref: from, path: path }));
      continue;
    }
    for (const raw of loaded.json.edges) {
      const edge = edgeFromRaw(from, raw);
      if (!edge) continue;
      if (edge.invalid) {
        errors.push(Object.assign({}, edge.error, { ref: from, relationshipPath: path }));
        continue;
      }
      if (!byTarget.has(edge.to)) byTarget.set(edge.to, []);
      byTarget.get(edge.to).push(edge);
    }
  }
  return { byTarget: byTarget, truncated: Boolean(result && result.truncated) };
}

function edgeKey(edge) {
  return [edge.from, edge.to, edge.type || '', edge.since === undefined ? '' : edge.since, edge.until === undefined ? '' : edge.until, edge.note || ''].join('\u0001');
}

function addUnique(list, seen, value, key) {
  const actualKey = key || JSON.stringify(value);
  if (seen.has(actualKey)) return false;
  seen.add(actualKey);
  list.push(value);
  return true;
}

async function readEntities(input, tsian, signal) {
  const request = normalizeInput(input);
  const errors = [];
  const missing = [];
  const missingRefs = new Set();
  const entities = [];
  const entityRefs = new Set();
  const edges = [];
  const edgeKeys = new Set();
  const unexpanded = [];
  const unexpandedKeys = new Set();
  const queue = request.refs.map(function (ref) { return { ref: ref, depth: 0, explicit: true }; });
  const queuedRefs = new Set(request.refs);
  const relation = request.relations;
  let incoming = null;
  let incomingScanTruncated = false;
  const truncated = { entities: false, edges: false, relationshipScan: false };

  if (relation.depth > 0 && (relation.direction === 'incoming' || relation.direction === 'both')) {
    const built = await buildIncomingIndex(tsian, signal, errors);
    incoming = built.byTarget;
    incomingScanTruncated = built.truncated;
    truncated.relationshipScan = incomingScanTruncated;
  }

  for (let index = 0; index < queue.length; index += 1) {
    throwIfAborted(signal);
    const current = queue[index];
    const path = entityPath(current.ref);
    const loaded = await readJson(tsian, path, signal, 'READ_ENTITIES_ENTITY');
    if (loaded.state === 'missing') {
      addUnique(missing, missingRefs, { ref: current.ref, path: path, code: 'READ_ENTITIES_ENTITY_NOT_FOUND' }, current.ref);
      continue;
    }
    if (loaded.state === 'error') {
      errors.push(Object.assign({}, loaded.error, { ref: current.ref, path: path }));
      continue;
    }
    if (!entityRefs.has(current.ref)) {
      entityRefs.add(current.ref);
      entities.push({ ref: current.ref, path: path, entity: projectEntity(loaded.json, request.fields) });
    }
    if (relation.depth === 0 || !relation.direction) continue;

    let related = [];
    if (relation.direction === 'outgoing' || relation.direction === 'both') {
      related = related.concat(await readOutgoingEdges(tsian, current.ref, signal, errors));
    }
    if ((relation.direction === 'incoming' || relation.direction === 'both') && incoming) {
      related = related.concat(incoming.get(current.ref) || []);
    }
    const typeSet = new Set(relation.types);
    for (const edge of related) {
      throwIfAborted(signal);
      if (typeSet.size > 0 && !typeSet.has(edge.type)) continue;
      const key = edgeKey(edge);
      if (edgeKeys.has(key)) continue;
      if (edges.length >= relation.maxEdges) {
        truncated.edges = true;
        addUnique(unexpanded, unexpandedKeys, { from: edge.from, to: edge.to, reason: 'max_edges' }, edge.from + '\u0001' + edge.to + '\u0001max_edges');
        break;
      }
      edgeKeys.add(key);
      edges.push(edge);
      if (current.depth >= relation.depth) {
        addUnique(unexpanded, unexpandedKeys, { from: edge.from, to: edge.to, reason: 'depth_limit' }, edge.from + '\u0001' + edge.to + '\u0001depth_limit');
        continue;
      }
      const nextRef = edge.from === current.ref ? edge.to : edge.from;
      if (queuedRefs.has(nextRef) || entityRefs.has(nextRef)) continue;
      if (queuedRefs.size >= relation.maxEntities) {
        truncated.entities = true;
        addUnique(unexpanded, unexpandedKeys, { from: edge.from, to: edge.to, reason: 'max_entities' }, edge.from + '\u0001' + edge.to + '\u0001max_entities');
        continue;
      }
      queuedRefs.add(nextRef);
      queue.push({ ref: nextRef, depth: current.depth + 1, explicit: false });
    }
  }

  let status = 'ok';
  if (missing.length > 0 || errors.length > 0 || truncated.entities || truncated.edges || truncated.relationshipScan) status = 'partial';
  const output = {
    status: status,
    entities: entities,
    edges: edges,
    missing: missing,
    errors: errors,
    unexpanded: unexpanded,
    truncated: truncated,
  };
  tsian.trace('read_entities', { status: status, entityCount: entities.length, edgeCount: edges.length, missingCount: missing.length, errorCount: errors.length, truncated: truncated });
  return output;
}

async function runReadEntities(input, tsian, signal) {
  try {
    return await readEntities(input, tsian, signal);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.message) {
      return { status: 'failed', entities: [], edges: [], missing: [], errors: [errorShape(error.code, error.message, error.details)], unexpanded: [], truncated: { entities: false, edges: false, relationshipScan: false } };
    }
    throw error;
  }
}

return runReadEntities(input, tsian, signal);
