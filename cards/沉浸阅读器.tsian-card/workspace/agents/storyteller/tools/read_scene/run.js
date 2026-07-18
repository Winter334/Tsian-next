// read_scene：读 save/scenes/<localId>.json + 在场实体 name/brief，格式化返回。
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function parseSceneRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) fail('READ_SCENE_INVALID_ARGS', 'ref must be a non-empty string.', { ref: ref });
  const parts = ref.split(':');
  if (parts.length !== 2 || parts[0] !== 'scene' || !parts[1]) fail('READ_SCENE_INVALID_ARGS', 'ref must use scene:<localId>.', { ref: ref });
  return { localId: parts[1] };
}
function refToPath(ref) {
  const seg = ref.split(':');
  if (seg.length !== 2 || !seg[0] || !seg[1]) return null;
  return 'save/entities/' + seg[0] + '/' + seg[1] + '.json';
}
async function readEntityNameBrief(tsian, ref, signal) {
  const path = refToPath(ref);
  if (!path) return { name: ref, brief: '' };
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') return { name: ref, brief: '' };
  try {
    const entity = JSON.parse(file.content);
    if (!isRecord(entity)) return { name: ref, brief: '' };
    return { name: entity.name || ref, brief: typeof entity.brief === 'string' ? entity.brief : '' };
  } catch (e) { return { name: ref, brief: '' }; }
}
async function readScene(input, tsian, signal) {
  if (!isRecord(input)) fail('READ_SCENE_INVALID_ARGS', 'input must be an object.', { input: input });
  const parsed = parseSceneRef(input.ref);
  const path = 'save/scenes/' + parsed.localId + '.json';
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') fail('READ_SCENE_NOT_FOUND', 'Scene file not found.', { ref: input.ref, path: path });
  let scene;
  try { scene = JSON.parse(file.content); } catch (e) { fail('READ_SCENE_JSON_INVALID', 'Scene file is not valid JSON.', { path: path }); }
  if (!isRecord(scene)) fail('READ_SCENE_INVALID', 'Scene must be a JSON object.', { path: path });
  const lines = [];
  lines.push((scene.name || input.ref) + '（' + (scene.id || input.ref) + '）');
  if (scene.status) lines.push('状态：' + scene.status);
  if (isRecord(scene.location) && scene.location.name) lines.push('地点：' + scene.location.name);
  const present = Array.isArray(scene.present) ? scene.present : [];
  const presentEntries = [];
  for (const item of present) {
    if (!isRecord(item) || typeof item.ref !== 'string') continue;
    signal.throwIfAborted();
    const info = await readEntityNameBrief(tsian, item.ref, signal);
    presentEntries.push('- ' + info.name + (info.brief ? '：' + info.brief : ''));
  }
  if (presentEntries.length) {
    lines.push('在场角色：');
    for (const entry of presentEntries) lines.push(entry);
  }
  const text = lines.join('\n');
  tsian.trace('read_scene', { ref: input.ref, path: path, presentCount: presentEntries.length, length: text.length });
  return { text: text };
}
return readScene(input, tsian, signal);
