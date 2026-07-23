// read_maintenance_context：聚合目标 turn 正文、runtime、active scene、相关 entity/relationship、memory 文本、scene 清理候选、optional timeline。
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function throwIfAborted(signal) { if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted(); }
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (/[\s/\\\0]/.test(parts[0]) || /[\s/\\\0]/.test(parts[1])) return null;
  return { type: parts[0], localId: parts[1] };
}
function refToEntityPath(ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  if (parsed.type === 'scene') return 'save/scenes/' + parsed.localId + '.json';
  return 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
}
function scenePathFromRef(ref) {
  const parsed = parseRef(ref);
  if (!parsed || parsed.type !== 'scene') return null;
  return 'save/scenes/' + parsed.localId + '.json';
}
function relationshipPathForRef(ref) {
  const parsed = parseRef(ref);
  if (!parsed || parsed.type !== 'character') return null;
  return 'save/relationships/character-' + parsed.localId + '.json';
}
function docTargetFromPath(path, json) {
  if (isRecord(json) && typeof json.id === 'string') return json.id;
  if (isRecord(json) && typeof json.subject === 'string') return path;
  return path;
}
function uniquePushDoc(docs, seenPaths, path, json, target) {
  if (!path || !isRecord(json) || seenPaths.has(path)) return;
  seenPaths.add(path);
  docs.push({ target: target || docTargetFromPath(path, json), path: path, kind: 'json', json: json });
}
async function readJsonFile(tsian, path, signal, optional) {
  throwIfAborted(signal);
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return null;
    try { return JSON.parse(file.content); } catch (e) { return null; }
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}
async function readTextFile(tsian, path, signal, optional) {
  throwIfAborted(signal);
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return null;
    return file.content;
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}
async function findTurnFile(tsian, turn, signal) {
  const padded = String(turn).padStart(6, '0');
  const directPath = 'save/history/turns/turn-' + padded + '.json';
  throwIfAborted(signal);
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: directPath });
    if (file && typeof file.content === 'string') return { path: directPath, content: file.content };
  } catch (e) {
    return null;
  }
  return null;
}
function extractTurnBody(parsed) {
  if (!isRecord(parsed)) return { user: '', assistant: '' };
  if (typeof parsed.user === 'string' || typeof parsed.assistant === 'string') {
    return { user: typeof parsed.user === 'string' ? parsed.user : '', assistant: typeof parsed.assistant === 'string' ? parsed.assistant : '' };
  }
  if (!Array.isArray(parsed.timeline)) return { user: '', assistant: '' };
  var user = '';
  var assistant = '';
  for (var item of parsed.timeline) {
    if (!isRecord(item) || typeof item.kind !== 'string') continue;
    if (item.kind === 'user' && typeof item.content === 'string' && !user) user = item.content;
    else if (item.kind === 'assistant' && typeof item.content === 'string') assistant = item.content;
  }
  return { user: user, assistant: assistant };
}
async function findMaxTurn(tsian, signal) {
  throwIfAborted(signal);
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/history/turns/turn-*.json', limit: 10000 });
  const matches = Array.isArray(result && result.matches) ? result.matches : [];
  let max = 0;
  for (const p of matches) {
    const m = /turn-(\d+)\.json$/.exec(p);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max;
}
function tailLines(text, count) {
  if (typeof text !== 'string') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(Math.max(0, lines.length - count));
}
function allLines(text) {
  if (typeof text !== 'string') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
function scenePresentRefs(scene) {
  if (!isRecord(scene) || !Array.isArray(scene.present)) return [];
  return scene.present.filter(function (p) { return isRecord(p) && typeof p.ref === 'string'; }).map(function (p) { return p.ref; });
}
async function readMaintenanceContext(input, tsian, signal) {
  if (!isRecord(input)) input = {};
  const includeTimeline = input.includeTimeline === true || input.timeline === true;
  const includeMemory = input.memory !== false;
  const requestedTurn = typeof input.turn === 'number' && input.turn > 0 ? Math.floor(input.turn) : 0;
  let turn = requestedTurn;
  var turnFallbackReason = null;
  if (turn === 0) turn = await findMaxTurn(tsian, signal);

  let turnBody = null;
  if (turn > 0) {
    var turnFile = await findTurnFile(tsian, turn, signal);
    if (!turnFile && requestedTurn > 0) {
      var fallbackTurn = await findMaxTurn(tsian, signal);
      if (fallbackTurn > 0 && fallbackTurn !== turn) {
        turnFallbackReason = 'requested turn file not found; using max turn';
        turn = fallbackTurn;
        turnFile = await findTurnFile(tsian, turn, signal);
      }
    }
    if (turnFile) {
      let parsed; try { parsed = JSON.parse(turnFile.content); } catch (e) { parsed = null; }
      if (isRecord(parsed)) turnBody = extractTurnBody(parsed);
    }
  }

  const docs = [];
  const seenPaths = new Set();
  const runtime = await readJsonFile(tsian, 'save/playthrough/runtime.json', signal, true);
  if (isRecord(runtime)) uniquePushDoc(docs, seenPaths, 'save/playthrough/runtime.json', runtime, 'save/playthrough/runtime.json');

  const activeSceneRefs = [];
  const activeScenes = [];
  const entityRefs = new Set();
  if (isRecord(runtime) && Array.isArray(runtime.activeSceneRefs)) {
    for (const s of runtime.activeSceneRefs) {
      if (!isRecord(s) || typeof s.ref !== 'string') continue;
      activeSceneRefs.push(s.ref);
      const scenePath = scenePathFromRef(s.ref);
      const scene = scenePath ? await readJsonFile(tsian, scenePath, signal, true) : null;
      if (isRecord(scene)) {
        activeScenes.push({ target: s.ref, path: scenePath });
        uniquePushDoc(docs, seenPaths, scenePath, scene, s.ref);
        for (const ref of scenePresentRefs(scene)) entityRefs.add(ref);
      }
    }
  }
  if (isRecord(runtime) && isRecord(runtime.protagonistRef) && typeof runtime.protagonistRef.ref === 'string') entityRefs.add(runtime.protagonistRef.ref);

  const entities = [];
  for (const ref of entityRefs) {
    const path = refToEntityPath(ref);
    if (!path) continue;
    const entity = await readJsonFile(tsian, path, signal, true);
    if (!isRecord(entity)) continue;
    entities.push({ target: ref, path: path });
    uniquePushDoc(docs, seenPaths, path, entity, ref);
  }

  const relationships = [];
  for (const ref of entityRefs) {
    const path = relationshipPathForRef(ref);
    if (!path) continue;
    const rel = await readJsonFile(tsian, path, signal, true);
    if (!isRecord(rel)) continue;
    relationships.push({ target: path, path: path });
    uniquePushDoc(docs, seenPaths, path, rel, path);
  }

  const texts = [];
  var memory = null;
  if (includeMemory) {
    const recordsPath = 'save/memory/records.md';
    const seedsPath = 'save/memory/seeds.md';
    const recordsText = await readTextFile(tsian, recordsPath, signal, true);
    const seedsText = await readTextFile(tsian, seedsPath, signal, true);
    const recordsTail = tailLines(recordsText, 30);
    const seedsLines = allLines(seedsText);
    if (recordsText !== null) texts.push({ target: recordsPath, path: recordsPath, kind: 'text', tailLines: recordsTail });
    if (seedsText !== null) texts.push({ target: seedsPath, path: seedsPath, kind: 'text', lines: seedsLines });
    memory = { records: recordsText === null ? null : { path: recordsPath, tailLines: recordsTail }, seeds: seedsText === null ? null : { path: seedsPath, lines: seedsLines } };
  }

  const sceneGlob = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/scenes/*.json', limit: 10000 });
  const sceneMatches = Array.isArray(sceneGlob && sceneGlob.matches) ? sceneGlob.matches : [];
  const activeSceneRefSet = new Set(activeSceneRefs);
  const sceneCleanupCandidates = [];
  for (const p of sceneMatches) {
    throwIfAborted(signal);
    const sceneObj = await readJsonFile(tsian, p, signal, true);
    if (!isRecord(sceneObj) || typeof sceneObj.id !== 'string') continue;
    if (activeSceneRefSet.has(sceneObj.id)) continue;
    var status = typeof sceneObj.status === 'string' ? sceneObj.status : '';
    if (status === 'background') continue;
    sceneCleanupCandidates.push({ ref: sceneObj.id, path: p, status: status, reason: status === 'resolved' ? 'scene 已 resolved 且不在 activeSceneRefs' : 'scene 不在当前 activeSceneRefs（非 background）' });
  }

  var timeline = null;
  if (includeTimeline) {
    const frontier = await readJsonFile(tsian, 'save/playthrough/frontier.json', signal, true);
    if (isRecord(frontier)) {
      uniquePushDoc(docs, seenPaths, 'save/playthrough/frontier.json', frontier, 'save/playthrough/frontier.json');
    }
    if (isRecord(frontier) && Array.isArray(frontier.timeline)) {
      var sourceAnchors = [];
      var playerAnchors = [];
      for (var a of frontier.timeline) {
        if (!isRecord(a) || typeof a.kind !== 'string') continue;
        if (a.kind === 'source') sourceAnchors.push(a);
        else if (a.kind === 'player') playerAnchors.push(a);
      }
      timeline = { sourceAnchors: sourceAnchors, playerAnchors: playerAnchors, sourceWindow: isRecord(frontier.sourceWindow) ? frontier.sourceWindow : null };
    }
  }

  var output = {
    requestedTurn: requestedTurn || turn,
    turn: turn,
    turnFallbackReason: turnFallbackReason,
    turnBody: turnBody,
    docs: docs,
    texts: texts,
    runtime: runtime,
    activeScenes: activeScenes,
    entities: entities,
    relationships: relationships,
    memory: memory,
    sceneCleanupCandidates: sceneCleanupCandidates,
    timeline: timeline,
  };
  tsian.trace('read_maintenance_context', { requestedTurn: requestedTurn || turn, turn: turn, turnFallbackReason: turnFallbackReason, docCount: docs.length, textCount: texts.length, cleanupCandidates: sceneCleanupCandidates.length, includeTimeline: includeTimeline });
  return output;
}
return readMaintenanceContext(input, tsian, signal);
