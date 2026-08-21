const OPENING_CONTROL_PATH = 'save/playthrough/opening-interview.json';
const OPENING_SETUP_PATH = 'save/playthrough/setup-summary.json';
const OPENING_RUNTIME_PATH = 'save/playthrough/runtime.json';
const OPENING_FRONTIER_PATH = 'save/playthrough/frontier.json';
const OPENING_TURN_ZERO_PATH = 'save/history/turns/turn-000000.json';

async function openingOptionalFile(tsian, path) {
  try {
    return await tsian.workspace.read({ scope: 'effective', path: path });
  } catch (error) {
    if (error && error.code === 'WORKSPACE_FILE_NOT_FOUND') return null;
    throw error;
  }
}

async function openingOptionalJson(tsian, path) {
  const file = await openingOptionalFile(tsian, path);
  return file && typeof file.content === 'string' ? parseJson(file.content, path) : null;
}

async function openingGlob(tsian, pattern, code) {
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: pattern, limit: 10000 });
  const matches = Array.isArray(result && result.matches) ? result.matches.slice().sort() : [];
  if (result && result.truncated) fail(code || 'OPENING_WORKSPACE_TOO_LARGE', 'Workspace match limit was exceeded.', { pattern: pattern, matched: matches.length });
  return matches;
}

function openingHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function openingCanonical(value) {
  if (Array.isArray(value)) return value.map(openingCanonical);
  if (!isRecord(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = openingCanonical(value[key]);
  }
  return result;
}

function openingJsonEqual(left, right) {
  return JSON.stringify(openingCanonical(left)) === JSON.stringify(openingCanonical(right));
}

function openingInteger(value, code, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(code, label + ' must be a safe integer in range.', { value: value, min: min, max: max });
  }
  return value;
}

function openingSafeAgentId(value) {
  const id = normalizeString(value, 'OPENING_PLAYER_TURN_AGENT_REQUIRED', 'playerTurn agent id', 120);
  if (id === '.' || id === '..' || /[\\/\x00-\x1f\x7f]/.test(id)) {
    fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent id must be a safe path segment.', { id: id });
  }
  return id;
}

async function openingPlayerTurnAgent(tsian) {
  const cardManifest = await readJson(tsian, 'game-card.json');
  const entrypoints = isRecord(cardManifest.runtime) && isRecord(cardManifest.runtime.entrypoints) ? cardManifest.runtime.entrypoints : null;
  const id = openingSafeAgentId(entrypoints && entrypoints.playerTurn);
  const config = await readJson(tsian, 'agents/' + id + '/agent.json');
  if (!isRecord(config) || config.id !== id) {
    fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent config identity does not match its entrypoint.', { playerTurnAgentId: id });
  }
  const instructions = await readText(tsian, 'agents/' + id + '/AGENT.md');
  if (!instructions.trim()) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent instructions are empty.', { playerTurnAgentId: id });
  return id;
}

async function openingStatus(tsian) {
  const setup = await openingOptionalJson(tsian, OPENING_SETUP_PATH);
  const runtime = await openingOptionalJson(tsian, OPENING_RUNTIME_PATH);
  const turnPaths = await openingGlob(tsian, 'save/history/turns/turn-*.json', 'OPENING_HISTORY_TOO_LARGE');
  const progressedTurnPaths = turnPaths.filter(function (path) { return path !== OPENING_TURN_ZERO_PATH; });
  if ((isRecord(setup) && setup.enteredPlay === true)
    || (isRecord(runtime) && Number.isSafeInteger(runtime.turn) && runtime.turn > 0)
    || progressedTurnPaths.length > 0) {
    fail('OPENING_PLAY_ALREADY_STARTED', 'Formal play has already started; opening data cannot be replaced.', {
      enteredPlay: isRecord(setup) && setup.enteredPlay === true,
      runtimeTurn: runtime && runtime.turn,
      progressedTurnPaths: progressedTurnPaths,
    });
  }
  if (!isRecord(setup) || (setup.status !== 'pending' && setup.status !== 'complete')) {
    fail('OPENING_SETUP_STATE_INVALID', 'setup-summary.json must be pending or complete.');
  }
  if (setup.status === 'pending' && turnPaths.includes(OPENING_TURN_ZERO_PATH)) {
    fail('OPENING_PUBLISH_CONFLICT', 'Turn 0 exists while setup is still pending.', { path: OPENING_TURN_ZERO_PATH });
  }
  return { setup: setup, runtime: runtime, turnPaths: turnPaths, complete: setup.status === 'complete' };
}

async function openingSessionAuthority(tsian) {
  const source = await loadSource(tsian);
  if (source.chapters.length === 0 || source.manifest.chapterCount !== source.chapters.length
    || typeof source.manifest.importedAt !== 'string' || typeof source.manifest.normalizationVersion !== 'string'
    || typeof source.manifest.title !== 'string' || !source.manifest.title.trim()) {
    fail('OPENING_SOURCE_NOT_READY', 'Imported source manifest and chapter index do not describe the same ready source.');
  }
  const identity = {
    importedAt: source.manifest.importedAt,
    normalizationVersion: source.manifest.normalizationVersion,
    title: source.manifest.title,
    chapterCount: source.manifest.chapterCount,
  };
  const sourceHash = openingHash(JSON.stringify(identity));
  const control = await readJson(tsian, OPENING_CONTROL_PATH);
  if (!isRecord(control) || control.schema !== 'novel-airp.opening-interview.v2' || !isRecord(control.source) || !isRecord(control.session)
    || control.source.hash !== sourceHash || control.source.importedAt !== identity.importedAt
    || control.source.normalizationVersion !== identity.normalizationVersion || control.source.title !== identity.title
    || control.source.chapterCount !== identity.chapterCount || control.session.id !== 'opening-' + sourceHash
    || control.session.slot !== 'opening-interview-' + sourceHash || (control.branch !== 'canon' && control.branch !== 'original')) {
    fail('OPENING_SESSION_MISMATCH', 'Opening control does not match the imported source.');
  }
  return { source: source, control: control, sourceHash: sourceHash };
}

async function openingMutableAuthority(tsian) {
  const status = await openingStatus(tsian);
  if (status.complete) return { status: status, alreadyComplete: true };
  const authority = await openingSessionAuthority(tsian);
  return { status: status, alreadyComplete: false, source: authority.source, control: authority.control, sourceHash: authority.sourceHash };
}

async function openingWriteJson(tsian, path, value) {
  return tsian.workspace.write({
    scope: 'save-runtime',
    path: path,
    content: JSON.stringify(value, null, 2) + '\n',
    mediaType: 'application/json',
  });
}

async function openingReadJsonMap(tsian, paths, kind) {
  const result = new Map();
  for (const path of paths) {
    const value = await openingOptionalJson(tsian, path);
    if (!isRecord(value)) fail('OPENING_' + kind + '_FILE_INVALID', path + ' must contain a JSON object.', { path: path });
    result.set(path, value);
  }
  return result;
}

async function openingLoadEntities(tsian) {
  const paths = await openingGlob(tsian, 'save/entities/*/*.json', 'OPENING_ENTITY_GLOB_TRUNCATED');
  const byPath = await openingReadJsonMap(tsian, paths, 'ENTITY');
  const byId = new Map();
  for (const path of paths) {
    const entity = byPath.get(path);
    const parsed = normalizeEntityId(entity.id, 'Entity file id');
    const expectedPath = 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
    if (path !== expectedPath || byId.has(parsed.id)) {
      fail('OPENING_ENTITY_FILE_INVALID', 'Entity file path and id must agree and be unique.', { path: path, id: parsed.id, expectedPath: expectedPath });
    }
    if (typeof entity.name !== 'string' || !entity.name.trim() || typeof entity.brief !== 'string' || !entity.brief.trim()) {
      fail('OPENING_ENTITY_FILE_INVALID', 'Entity file name and brief are required.', { path: path });
    }
    byId.set(parsed.id, { path: path, value: entity, name: entity.name.trim(), parsed: parsed });
  }
  return { paths: paths, byPath: byPath, byId: byId };
}

async function openingLoadScenes(tsian) {
  const paths = await openingGlob(tsian, 'save/scenes/*.json', 'OPENING_SCENE_GLOB_TRUNCATED');
  const byPath = await openingReadJsonMap(tsian, paths, 'SCENE');
  const byId = new Map();
  for (const path of paths) {
    const scene = byPath.get(path);
    const parsed = normalizeEntityId(scene.id, 'Scene file id');
    const expectedPath = 'save/scenes/' + parsed.localId + '.json';
    if (parsed.type !== 'scene' || path !== expectedPath || byId.has(parsed.id)) {
      fail('OPENING_SCENE_FILE_INVALID', 'Scene file path and id must agree and be unique.', { path: path, id: parsed.id, expectedPath: expectedPath });
    }
    if (typeof scene.name !== 'string' || !scene.name.trim()) fail('OPENING_SCENE_FILE_INVALID', 'Scene file name is required.', { path: path });
    byId.set(parsed.id, { path: path, value: scene, name: scene.name.trim(), parsed: parsed });
  }
  return { paths: paths, byPath: byPath, byId: byId };
}

function openingAuthorityRef(raw, label, targets, expectedType) {
  if (!isRecord(raw)) fail('OPENING_REF_INVALID', label + ' must be an object with ref.', { label: label });
  const parsed = normalizeEntityId(raw.ref, label + ' ref');
  const target = targets.get(parsed.id);
  if ((expectedType && parsed.type !== expectedType) || !target) {
    fail('OPENING_REF_UNKNOWN', label + ' points to a missing or incompatible authority file.', { ref: parsed.id, expectedType: expectedType || null });
  }
  return { ref: parsed.id, name: target.name };
}

function openingAssertPathSet(existingPaths, targetPaths, code, phase) {
  const extras = existingPaths.filter(function (path) { return !targetPaths.has(path); });
  if (extras.length > 0) fail(code, phase + ' contains paths outside this complete phase input.', { paths: extras.slice(0, 50) });
}

async function openingLockedPhaseIsIdentical(tsian, proposedByPath, existingPaths) {
  if (existingPaths.length !== proposedByPath.size) return false;
  for (const path of existingPaths) {
    if (!proposedByPath.has(path)) return false;
    const current = await openingOptionalJson(tsian, path);
    if (!openingJsonEqual(current, proposedByPath.get(path))) return false;
  }
  return true;
}

function openingStateHasModel(runtime, frontier) {
  return (isRecord(runtime) && runtime.turn === 0 && isRecord(runtime.protagonistRef))
    || (isRecord(frontier) && isRecord(frontier.sourceWindow) && Number.isSafeInteger(frontier.sourceWindow.start));
}

async function openingProjectReply(tsian, openingReply) {
  const reply = normalizeString(openingReply, 'OPENING_REPLY_REQUIRED', 'openingReply', 24000);
  const projected = await tsian.reply.project(reply);
  const issues = [];
  const details = { displayContent: 'omitted', choiceCount: null };
  const diagnostics = [];
  if (!isRecord(projected)) {
    issues.push({ code: 'projection.missing', path: 'projection' });
  } else {
    if (typeof projected.content !== 'string' || !projected.content.trim()) issues.push({ code: 'content.empty', path: 'content' });
    let visibleContent;
    if (projected.displayContent === undefined) visibleContent = projected.content;
    else if (typeof projected.displayContent !== 'string') {
      details.displayContent = 'invalid';
      issues.push({ code: 'display.invalid', path: 'displayContent' });
    } else {
      details.displayContent = 'present';
      visibleContent = projected.displayContent;
    }
    if (typeof visibleContent === 'string' && !visibleContent.trim()) issues.push({ code: 'display.empty', path: 'displayContent' });
    const choices = isRecord(projected.projections) ? projected.projections.choices : undefined;
    if (!Array.isArray(choices)) issues.push({ code: 'choices.missing', path: 'projections.choices' });
    else {
      details.choiceCount = choices.length;
      if (choices.length < 1 || choices.length > 12) issues.push({ code: 'choices.count', path: 'projections.choices' });
      const invalidChoiceIndices = [];
      for (let index = 0; index < choices.length && index < 20; index += 1) {
        if (typeof choices[index] !== 'string' || !choices[index].trim() || choices[index].length > 300) invalidChoiceIndices.push(index);
      }
      if (invalidChoiceIndices.length > 0) issues.push({ code: 'choices.item', path: 'projections.choices', indices: invalidChoiceIndices });
    }
    if (typeof projected.configPresent === 'boolean') details.configPresent = projected.configPresent;
    if (Number.isSafeInteger(projected.ruleCount) && projected.ruleCount >= 0) details.ruleCount = projected.ruleCount;
    if (Number.isSafeInteger(projected.appliedRuleCount) && projected.appliedRuleCount >= 0) details.appliedRuleCount = projected.appliedRuleCount;
    if (Array.isArray(projected.diagnostics)) {
      for (const diagnostic of projected.diagnostics.slice(0, 20)) {
        if (!isRecord(diagnostic) || typeof diagnostic.scope !== 'string' || typeof diagnostic.code !== 'string' || typeof diagnostic.message !== 'string') continue;
        const safe = { scope: diagnostic.scope.slice(0, 40), code: diagnostic.code.slice(0, 120), message: diagnostic.message.slice(0, 500) };
        if (typeof diagnostic.path === 'string') safe.path = diagnostic.path.slice(0, 500);
        if (typeof diagnostic.ruleId === 'string') safe.ruleId = diagnostic.ruleId.slice(0, 120);
        if (Number.isSafeInteger(diagnostic.ruleIndex) && diagnostic.ruleIndex >= 0) safe.ruleIndex = diagnostic.ruleIndex;
        diagnostics.push(safe);
      }
    }
  }
  if (issues.length > 0) {
    fail('OPENING_REPLY_PROJECTION_FAILED', 'openingReply projection is invalid; inspect details.issues.', {
      issues: issues,
      projection: details,
      diagnostics: diagnostics,
    });
  }
  return projected;
}
