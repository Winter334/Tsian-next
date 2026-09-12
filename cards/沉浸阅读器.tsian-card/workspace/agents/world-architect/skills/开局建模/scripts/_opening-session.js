const OPENING_CONTROL_PATH = 'save/playthrough/opening-interview.json';
const OPENING_SETUP_PATH = 'save/playthrough/setup-summary.json';
const OPENING_RUNTIME_PATH = 'save/playthrough/runtime.json';
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

async function openingWriteJson(tsian, path, value) {
  return tsian.workspace.write({
    scope: 'save-runtime',
    path: path,
    content: JSON.stringify(value, null, 2) + '\n',
    mediaType: 'application/json',
  });
}
