// read_maintenance_context：聚合目标 turn 正文、runtime、scenes、entities、relationships、scene 清理候选、optional timeline。
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { type: parts[0], localId: parts[1] };
}
function refToEntityPath(ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
}
function sceneLocalId(ref) {
  const parsed = parseRef(ref);
  if (!parsed || parsed.type !== 'scene') return null;
  return parsed.localId;
}
async function readJsonFile(tsian, path, signal) {
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') return null;
  try { return JSON.parse(file.content); } catch (e) { return null; }
}
async function readTextFile(tsian, path, signal) {
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') return null;
  return file.content;
}
async function findTurnFile(tsian, turn, signal) {
  const padded = String(turn).padStart(6, '0');
  const directPath = 'save/history/turns/turn-' + padded + '.json';
  signal.throwIfAborted();
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
    var legacyUser = typeof parsed.user === 'string' ? parsed.user : '';
    var legacyAssistant = typeof parsed.assistant === 'string' ? parsed.assistant : '';
    return { user: legacyUser, assistant: legacyAssistant };
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
async function readEntityBrief(tsian, ref, signal) {
  const path = refToEntityPath(ref);
  if (!path) return { ref: ref, name: ref, brief: '' };
  const entity = await readJsonFile(tsian, path, signal);
  if (!isRecord(entity)) return { ref: ref, name: ref, brief: '' };
  return { ref: ref, name: entity.name || ref, brief: typeof entity.brief === 'string' ? entity.brief : '' };
}
async function readSceneSummary(tsian, ref, signal) {
  const localId = sceneLocalId(ref);
  if (!localId) return { ref: ref, name: ref, location: null, present: [], status: '' };
  const path = 'save/scenes/' + localId + '.json';
  const scene = await readJsonFile(tsian, path, signal);
  if (!isRecord(scene)) return { ref: ref, name: ref, location: null, present: [], status: '' };
  const present = Array.isArray(scene.present) ? scene.present.filter(function (p) { return isRecord(p) && typeof p.ref === 'string'; }).map(function (p) { return p.ref; }) : [];
  const location = isRecord(scene.location) && scene.location.ref ? { ref: scene.location.ref, name: scene.location.name || '' } : null;
  return { ref: ref, name: scene.name || ref, location: location, present: present, status: scene.status || '' };
}
async function readRelationshipEdges(tsian, ref, signal) {
  const parsed = parseRef(ref);
  if (!parsed) return [];
  const scope = parsed.type + '-' + parsed.localId;
  const path = 'save/relationships/' + scope + '.json';
  const rel = await readJsonFile(tsian, path, signal);
  if (!isRecord(rel) || !Array.isArray(rel.edges)) return [];
  return rel.edges.filter(function (e) { return isRecord(e) && typeof e.to === 'string'; }).map(function (e) { return { to: e.to, type: e.type || '', note: typeof e.note === 'string' ? e.note : '' }; });
}
async function findMaxTurn(tsian, signal) {
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/history/turns/turn-*.json', limit: 10000 });
  const matches = Array.isArray(result && result.matches) ? result.matches : [];
  let max = 0;
  for (const p of matches) {
    const m = /turn-(\d+)\.json$/.exec(p);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max;
}
async function readMaintenanceContext(input, tsian, signal) {
  if (!isRecord(input)) input = {};
  const includeTimeline = input.includeTimeline === true;
  // 1. 确定目标 turn
  const requestedTurn = typeof input.turn === 'number' && input.turn > 0 ? Math.floor(input.turn) : 0;
  let turn = requestedTurn;
  var turnFallbackReason = null;
  if (turn === 0) { turn = await findMaxTurn(tsian, signal); }
  // 2. 读 turn 正文
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
      if (isRecord(parsed)) {
        turnBody = extractTurnBody(parsed);
      }
    }
  }
  // 3. 读 runtime.json
  const runtime = await readJsonFile(tsian, 'save/playthrough/runtime.json', signal);
  // 4. 读 active scenes
  const activeScenes = [];
  if (isRecord(runtime) && Array.isArray(runtime.activeSceneRefs)) {
    for (const s of runtime.activeSceneRefs) {
      if (!isRecord(s) || typeof s.ref !== 'string') continue;
      signal.throwIfAborted();
      const summary = await readSceneSummary(tsian, s.ref, signal);
      activeScenes.push(summary);
    }
  }
  // 5. 读相关 entities：聚合 active scenes 的 present entities + protagonist
  const entityRefs = new Set();
  for (const scene of activeScenes) { for (const ref of scene.present) { entityRefs.add(ref); } }
  if (isRecord(runtime) && isRecord(runtime.protagonistRef) && typeof runtime.protagonistRef.ref === 'string') { entityRefs.add(runtime.protagonistRef.ref); }
  const entities = [];
  for (const ref of entityRefs) {
    signal.throwIfAborted();
    const brief = await readEntityBrief(tsian, ref, signal);
    entities.push(brief);
  }
  // 6. 读相关 relationships：只读 character 类型 entity 的关系分片
  const relationships = [];
  for (const ref of entityRefs) {
    const parsed = parseRef(ref);
    if (!parsed || parsed.type !== 'character') continue;
    signal.throwIfAborted();
    const edges = await readRelationshipEdges(tsian, ref, signal);
    if (edges.length > 0) relationships.push({ subject: ref, edges: edges });
  }
  // 7. scene 清理候选：glob save/scenes/*.json，找出不在 activeSceneRefs 也不在 background 的 resolved/旧 scene
  const sceneGlob = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/scenes/*.json', limit: 10000 });
  const sceneMatches = Array.isArray(sceneGlob && sceneGlob.matches) ? sceneGlob.matches : [];
  const activeSceneRefSet = new Set(activeScenes.map(function (s) { return s.ref; }));
  const sceneCleanupCandidates = [];
  for (const p of sceneMatches) {
    signal.throwIfAborted();
    const sceneObj = await readJsonFile(tsian, p, signal);
    if (!isRecord(sceneObj) || typeof sceneObj.id !== 'string') continue;
    if (activeSceneRefSet.has(sceneObj.id)) continue;
    var status = typeof sceneObj.status === 'string' ? sceneObj.status : '';
    if (status === 'background') continue;
    sceneCleanupCandidates.push({ ref: sceneObj.id, path: p, status: status, reason: status === 'resolved' ? 'scene 已 resolved 且不在 activeSceneRefs' : 'scene 不在当前 activeSceneRefs（非 background）' });
  }
  // 8. optional timeline
  var timeline = null;
  if (includeTimeline) {
    const frontier = await readJsonFile(tsian, 'save/playthrough/frontier.json', signal);
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
    runtime: runtime,
    activeScenes: activeScenes,
    entities: entities,
    relationships: relationships,
    sceneCleanupCandidates: sceneCleanupCandidates,
    timeline: timeline,
  };
  tsian.trace('read_maintenance_context', { requestedTurn: requestedTurn || turn, turn: turn, turnFallbackReason: turnFallbackReason, activeSceneCount: activeScenes.length, entityCount: entities.length, relationshipCount: relationships.length, cleanupCandidates: sceneCleanupCandidates.length, includeTimeline: includeTimeline });
  return output;
}
return readMaintenanceContext(input, tsian, signal);
