// read_relationships：读 save/relationships/<scope>.json，格式化返回关系边。
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) fail('READ_RELATIONSHIPS_INVALID_ARGS', 'ref must be a non-empty string.', { ref: ref });
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail('READ_RELATIONSHIPS_INVALID_ARGS', 'ref must use <type>:<localId>.', { ref: ref });
  return { type: parts[0], localId: parts[1] };
}
async function readEntityName(tsian, ref, signal) {
  const seg = ref.split(':');
  if (seg.length !== 2 || !seg[0] || !seg[1]) return ref;
  const path = 'save/entities/' + seg[0] + '/' + seg[1] + '.json';
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') return ref;
  try { const entity = JSON.parse(file.content); return (isRecord(entity) && entity.name) ? entity.name : ref; } catch (e) { return ref; }
}
async function readRelationships(input, tsian, signal) {
  if (!isRecord(input)) fail('READ_RELATIONSHIPS_INVALID_ARGS', 'input must be an object.', { input: input });
  const parsed = parseRef(input.ref);
  const scope = parsed.type + '-' + parsed.localId;
  const path = 'save/relationships/' + scope + '.json';
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') fail('READ_RELATIONSHIPS_NOT_FOUND', 'Relationship file not found.', { ref: input.ref, path: path });
  let rel;
  try { rel = JSON.parse(file.content); } catch (e) { fail('READ_RELATIONSHIPS_JSON_INVALID', 'Relationship file is not valid JSON.', { path: path }); }
  if (!isRecord(rel)) fail('READ_RELATIONSHIPS_INVALID', 'Relationship must be a JSON object.', { path: path });
  const subjectName = await readEntityName(tsian, rel.subject || input.ref, signal);
  const lines = [];
  lines.push(subjectName + ' 的关系：');
  const edges = Array.isArray(rel.edges) ? rel.edges : [];
  for (const edge of edges) {
    if (!isRecord(edge) || typeof edge.to !== 'string') continue;
    signal.throwIfAborted();
    const toName = await readEntityName(tsian, edge.to, signal);
    const type = edge.type || '';
    const note = typeof edge.note === 'string' && edge.note.trim() ? ' — ' + edge.note : '';
    lines.push('- ' + toName + (type ? '（' + type + '）' : '') + note);
  }
  if (edges.length === 0) lines.push('（无关系记录）');
  const text = lines.join('\n');
  tsian.trace('read_relationships', { ref: input.ref, path: path, edgeCount: edges.length, length: text.length });
  return { text: text };
}
return readRelationships(input, tsian, signal);
