// query_entities: indexes matching entity files without returning full entity documents.
const ENTITY_SCAN_LIMIT = 400;

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

function comparable(value) {
  return normalizeText(value).toLocaleLowerCase();
}

function parseRef(value, field) {
  const ref = normalizeText(value);
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /[\s/\\\0]/.test(parts[0]) || /[\s/\\\0]/.test(parts[1]) || parts[0] === '.' || parts[0] === '..' || parts[1] === '.' || parts[1] === '..') {
    fail('QUERY_ENTITIES_INVALID_REF', (field || 'ref') + ' must use <type>:<localId> without whitespace or path separators.', { value: value });
  }
  return { ref: parts[0] + ':' + parts[1], type: parts[0], localId: parts[1] };
}

function pathForEntityRef(ref) {
  const parsed = parseRef(ref, 'entity ref');
  return 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
}

function pathForSceneRef(ref) {
  const parsed = parseRef(ref, 'sceneRefs entry');
  if (parsed.type !== 'scene') {
    fail('QUERY_ENTITIES_SCENE_REF_INVALID', 'sceneRefs entries must use scene:<localId>.', { ref: ref });
  }
  return 'save/scenes/' + parsed.localId + '.json';
}

function entityRefFromPath(path) {
  const match = /^save\/entities\/([^/]+)\/([^/]+)\.json$/.exec(path);
  return match ? match[1] + ':' + match[2] : null;
}

function uniqueStrings(value, field, maxItems) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('QUERY_ENTITIES_' + field.toUpperCase() + '_INVALID', field + ' must be an array when present.', { value: value });
  if (value.length === 0 || value.length > maxItems) fail('QUERY_ENTITIES_' + field.toUpperCase() + '_COUNT_INVALID', field + ' has an invalid item count.', { length: value.length, maxItems: maxItems });
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const text = normalizeText(value[index]);
    if (!text) fail('QUERY_ENTITIES_' + field.toUpperCase() + '_INVALID', field + ' entries must be non-empty strings.', { index: index, value: value[index] });
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function validateTypeFilter(value) {
  if (value === '.' || value === '..' || /[\s/\\\\\0*?\[\]{}]/.test(value)) {
    fail('QUERY_ENTITIES_TYPES_INVALID', 'types entries must be safe entity directory names.', { value: value });
  }
  return value;
}

function normalizeInput(input) {
  if (!isRecord(input)) fail('QUERY_ENTITIES_INPUT_INVALID', 'input must be an object.', { input: input });
  const refs = uniqueStrings(input.refs, 'refs', 50).map(function (ref) { return parseRef(ref, 'refs entry').ref; });
  const types = uniqueStrings(input.types, 'types', 20).map(validateTypeFilter);
  const names = uniqueStrings(input.names, 'names', 20);
  const aliases = uniqueStrings(input.aliases, 'aliases', 20);
  const lifecycle = uniqueStrings(input.lifecycle, 'lifecycle', 12);
  const sceneRefs = uniqueStrings(input.sceneRefs, 'sceneRefs', 12).map(function (ref) { parseRef(ref, 'sceneRefs entry'); pathForSceneRef(ref); return ref; });
  const text = normalizeText(input.text);
  if (input.text !== undefined && !text) fail('QUERY_ENTITIES_TEXT_INVALID', 'text must be a non-empty string when present.', { value: input.text });
  if (text.length > 120) fail('QUERY_ENTITIES_TEXT_TOO_LONG', 'text may not exceed 120 characters.', { length: text.length });

  let relationship = null;
  if (input.relationship !== undefined) {
    if (!isRecord(input.relationship)) fail('QUERY_ENTITIES_RELATIONSHIP_INVALID', 'relationship must be an object when present.', { value: input.relationship });
    const toRefs = uniqueStrings(input.relationship.toRefs, 'relationship.toRefs', 20).map(function (ref) { return parseRef(ref, 'relationship.toRefs entry').ref; });
    const relationTypes = uniqueStrings(input.relationship.types, 'relationship.types', 20);
    if (toRefs.length === 0 && relationTypes.length === 0) {
      fail('QUERY_ENTITIES_RELATIONSHIP_EMPTY', 'relationship must include toRefs and/or types.', {});
    }
    relationship = { toRefs: toRefs, types: relationTypes };
  }

  const rawMaxResults = input.maxResults === undefined ? 12 : Number(input.maxResults);
  if (!Number.isInteger(rawMaxResults) || rawMaxResults < 1 || rawMaxResults > 50) {
    fail('QUERY_ENTITIES_MAX_RESULTS_INVALID', 'maxResults must be an integer from 1 to 50.', { value: input.maxResults });
  }
  if (refs.length === 0 && types.length === 0 && names.length === 0 && aliases.length === 0 && lifecycle.length === 0 && sceneRefs.length === 0 && !relationship && !text) {
    fail('QUERY_ENTITIES_FILTER_REQUIRED', 'Provide at least one filter. This tool does not enumerate the full entity index without a target.', {});
  }
  return {
    refs: refs,
    types: types,
    names: names,
    aliases: aliases,
    lifecycle: lifecycle,
    sceneRefs: sceneRefs,
    relationship: relationship,
    text: text,
    maxResults: rawMaxResults,
  };
}

async function readJson(tsian, path, signal) {
  throwIfAborted(signal);
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return { state: 'missing' };
    try {
      const json = JSON.parse(file.content);
      return isRecord(json) ? { state: 'ok', json: json } : { state: 'error', error: errorShape('QUERY_ENTITIES_JSON_SHAPE_INVALID', 'JSON document must be an object.', { path: path }) };
    } catch (error) {
      return { state: 'error', error: errorShape('QUERY_ENTITIES_JSON_INVALID', 'JSON document is invalid.', { path: path, message: errorMessage(error, 'JSON parse failed.') }) };
    }
  } catch (error) {
    if (error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'WORKSPACE_READ_NOT_FOUND' || error.code === 'FILE_NOT_FOUND')) return { state: 'missing' };
    return { state: 'error', error: errorShape(errorCode(error, 'QUERY_ENTITIES_READ_FAILED'), errorMessage(error, 'Workspace read failed.'), { path: path }) };
  }
}

function clip(value, maxLength) {
  const text = normalizeText(value);
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '...' : text;
}

function stringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (text) result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function relationshipPath(ref) {
  const parsed = parseRef(ref, 'entity ref');
  return parsed.type === 'character' ? 'save/relationships/character-' + parsed.localId + '.json' : null;
}

async function loadScenePresence(tsian, sceneRefs, signal, errors) {
  const presence = new Map();
  for (const ref of sceneRefs) {
    const path = pathForSceneRef(ref);
    const result = await readJson(tsian, path, signal);
    if (result.state === 'missing') {
      errors.push(errorShape('QUERY_ENTITIES_SCENE_NOT_FOUND', 'Scene filter file was not found.', { ref: ref, path: path }));
      continue;
    }
    if (result.state === 'error') {
      errors.push(Object.assign({}, result.error, { ref: ref }));
      continue;
    }
    const refs = new Set();
    const present = Array.isArray(result.json.present) ? result.json.present : [];
    for (const item of present) {
      if (isRecord(item) && typeof item.ref === 'string') refs.add(item.ref);
    }
    presence.set(ref, refs);
  }
  return presence;
}

async function relationshipMatches(tsian, ref, filter, signal, errors) {
  if (!filter) return { matched: true, reasons: [] };
  const path = relationshipPath(ref);
  if (!path) return { matched: false, reasons: [] };
  const result = await readJson(tsian, path, signal);
  if (result.state === 'missing') return { matched: false, reasons: [] };
  if (result.state === 'error') {
    errors.push(Object.assign({}, result.error, { ref: ref, relationshipPath: path }));
    return { matched: false, reasons: [] };
  }
  const edges = Array.isArray(result.json.edges) ? result.json.edges : [];
  const targetSet = new Set(filter.toRefs);
  const typeSet = new Set(filter.types);
  for (const edge of edges) {
    if (!isRecord(edge) || typeof edge.to !== 'string') continue;
    if (targetSet.size > 0 && !targetSet.has(edge.to)) continue;
    if (typeSet.size > 0 && !typeSet.has(normalizeText(edge.type))) continue;
    const parts = [];
    if (targetSet.size > 0) parts.push('relationship.to:' + edge.to);
    if (typeSet.size > 0) parts.push('relationship.type:' + normalizeText(edge.type));
    return { matched: true, reasons: parts };
  }
  return { matched: false, reasons: [] };
}

async function candidateForEntity(tsian, ref, path, entity, filter, scenePresence, signal, errors) {
  const reasons = [];
  const parsed = parseRef(ref, 'entity ref');
  const typeSet = new Set(filter.types);
  if (typeSet.size > 0) {
    if (!typeSet.has(parsed.type)) return null;
    reasons.push('type:' + parsed.type);
  }
  const refSet = new Set(filter.refs);
  if (refSet.size > 0) {
    if (!refSet.has(ref)) return null;
    reasons.push('ref:' + ref);
  }

  const name = normalizeText(entity.name);
  const aliases = stringArray(entity.aliases, 12);
  const nameSet = new Set(filter.names.map(comparable));
  if (nameSet.size > 0) {
    if (!nameSet.has(comparable(name))) return null;
    reasons.push('name:' + name);
  }
  const aliasSet = new Set(filter.aliases.map(comparable));
  if (aliasSet.size > 0) {
    const matchedAlias = aliases.find(function (alias) { return aliasSet.has(comparable(alias)); });
    if (!matchedAlias) return null;
    reasons.push('alias:' + matchedAlias);
  }
  const lifecycleSet = new Set(filter.lifecycle);
  const lifecycle = normalizeText(entity.lifecycle);
  if (lifecycleSet.size > 0) {
    if (!lifecycleSet.has(lifecycle)) return null;
    reasons.push('lifecycle:' + lifecycle);
  }
  if (filter.sceneRefs.length > 0) {
    const matchedScene = filter.sceneRefs.find(function (sceneRef) {
      const refs = scenePresence.get(sceneRef);
      return refs && refs.has(ref);
    });
    if (!matchedScene) return null;
    reasons.push('scene:' + matchedScene);
  }
  if (filter.text) {
    const needle = comparable(filter.text);
    const haystack = [ref, name, entity.brief].concat(aliases).map(comparable).join('\n');
    if (haystack.indexOf(needle) === -1) return null;
    reasons.push('text:' + filter.text);
  }
  const relationship = await relationshipMatches(tsian, ref, filter.relationship, signal, errors);
  if (!relationship.matched) return null;
  reasons.push.apply(reasons, relationship.reasons);
  return {
    ref: ref,
    path: path,
    type: parsed.type,
    name: name || ref,
    aliases: aliases,
    brief: clip(entity.brief, 180),
    lifecycle: lifecycle || null,
    updatedAtTurn: Number.isFinite(entity.updatedAtTurn) ? entity.updatedAtTurn : null,
    matchReasons: reasons,
  };
}

async function resolveCandidatePaths(tsian, filter, signal) {
  if (filter.refs.length > 0) {
    return { paths: filter.refs.map(function (ref) { return pathForEntityRef(ref); }), globTruncated: false, direct: true };
  }
  let pattern = 'save/entities/*/*.json';
  if (filter.types.length === 1) pattern = 'save/entities/' + filter.types[0] + '/*.json';
  throwIfAborted(signal);
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: pattern, limit: ENTITY_SCAN_LIMIT });
  return {
    paths: Array.isArray(result && result.matches) ? result.matches : [],
    globTruncated: Boolean(result && result.truncated),
    direct: false,
  };
}

async function queryEntities(input, tsian, signal) {
  const filter = normalizeInput(input);
  const errors = [];
  const missing = [];
  const scenePresence = await loadScenePresence(tsian, filter.sceneRefs, signal, errors);
  const source = await resolveCandidatePaths(tsian, filter, signal);
  const candidates = [];
  let scanned = 0;
  let resultLimitReached = false;
  for (const path of source.paths) {
    throwIfAborted(signal);
    const ref = entityRefFromPath(path);
    if (!ref) continue;
    if (candidates.length >= filter.maxResults) {
      resultLimitReached = true;
      break;
    }
    scanned += 1;
    const result = await readJson(tsian, path, signal);
    if (result.state === 'missing') {
      missing.push({ ref: ref, path: path, code: 'QUERY_ENTITIES_ENTITY_NOT_FOUND' });
      continue;
    }
    if (result.state === 'error') {
      errors.push(Object.assign({}, result.error, { ref: ref }));
      continue;
    }
    const candidate = await candidateForEntity(tsian, ref, path, result.json, filter, scenePresence, signal, errors);
    if (candidate) candidates.push(candidate);
  }
  const truncated = {
    entityScan: source.globTruncated,
    results: resultLimitReached,
  };
  const complete = !truncated.entityScan && !truncated.results;
  let status = 'ok';
  if (errors.length > 0 || !complete) status = 'partial';
  else if (candidates.length === 0) status = 'no_match';
  const output = {
    status: status,
    candidates: candidates,
    scanned: { count: scanned, complete: complete, scanLimit: ENTITY_SCAN_LIMIT },
    missing: missing,
    errors: errors,
    truncated: truncated,
  };
  tsian.trace('query_entities', { status: status, candidateCount: candidates.length, missingCount: missing.length, scanned: scanned, errorCount: errors.length, truncated: truncated });
  return output;
}

async function runQueryEntities(input, tsian, signal) {
  try {
    return await queryEntities(input, tsian, signal);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.message) {
      return { status: 'failed', candidates: [], missing: [], errors: [errorShape(error.code, error.message, error.details)] };
    }
    throw error;
  }
}

return runQueryEntities(input, tsian, signal);
