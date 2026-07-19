// read_entity：读 save/entities/<type>/<localId>.json，格式化为人类可读文本返回。
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function fail(code, message, details) { const error = new Error(message); error.code = code; if (details !== undefined) error.details = details; throw error; }
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) fail('READ_ENTITY_INVALID_ARGS', 'ref must be a non-empty string.', { ref: ref });
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail('READ_ENTITY_INVALID_ARGS', 'ref must use <type>:<localId>.', { ref: ref });
  return { type: parts[0], localId: parts[1] };
}
function pushPart(lines, label, value) {
  if (value === undefined || value === null || value === '') return;
  lines.push(label + '：' + value);
}
function formatIdentity(identity, lines) {
  if (!isRecord(identity)) return;
  const parts = [];
  const order = ['age', 'gender', 'role', 'affiliation', 'realm'];
  for (const key of order) { if (identity[key] !== undefined && identity[key] !== null && String(identity[key]).trim()) parts.push(String(identity[key])); }
  if (parts.length) lines.push('身份：' + parts.join(' · '));
}
function formatAttributes(attributes, lines) {
  if (!isRecord(attributes)) return;
  const parts = [];
  for (const key of Object.keys(attributes)) { if (attributes[key] !== undefined && attributes[key] !== null) parts.push(key + ' ' + attributes[key]); }
  if (parts.length) lines.push('属性：' + parts.join(' · '));
}
function formatGauges(gauges, lines) {
  if (!Array.isArray(gauges) || !gauges.length) return;
  const parts = gauges.map(function (g) {
    if (!isRecord(g)) return '';
    const name = g.name || g.id || '';
    const value = g.value !== undefined ? g.value : '';
    const max = g.max !== undefined && g.max !== null ? '/' + g.max : '';
    return name ? name + ' ' + value + max : '';
  }).filter(Boolean);
  if (parts.length) lines.push('量表：' + parts.join(' · '));
}
function formatStatus(status, lines) {
  if (!Array.isArray(status) || !status.length) return;
  const parts = status.map(function (s) {
    if (!isRecord(s)) return '';
    const name = s.name || s.id || '';
    const polarity = s.polarity ? '（' + s.polarity + '）' : '';
    const desc = s.description ? '— ' + s.description : '';
    return name ? name + polarity + desc : '';
  }).filter(Boolean);
  if (parts.length) lines.push('状态：' + parts.join(' · '));
}
function formatTraits(traits, lines) {
  if (!Array.isArray(traits) || !traits.length) return;
  for (const t of traits) {
    if (!isRecord(t)) continue;
    const name = t.name || t.id || '';
    if (!name) continue;
    const desc = t.description ? ' — ' + t.description : '';
    lines.push('特质：' + name + desc);
    if (Array.isArray(t.effects) && t.effects.length) {
      const effects = t.effects.filter(function (e) { return typeof e === 'string' && e.trim(); });
      if (effects.length) lines.push('  效果：' + effects.join(' · '));
    }
  }
}
function formatGoals(goals, lines) {
  if (!isRecord(goals)) return;
  const labels = { current: '当前', shortTerm: '短期', longTerm: '长期' };
  for (const key of ['current', 'shortTerm', 'longTerm']) {
    if (typeof goals[key] === 'string' && goals[key].trim()) lines.push('目标：' + labels[key] + '：' + goals[key]);
  }
}
function formatHistory(history, lines) {
  if (!Array.isArray(history) || !history.length) return;
  const events = history.map(function (item) {
    return isRecord(item) && typeof item.event === 'string' ? item.event.trim() : '';
  }).filter(Boolean);
  if (!events.length) return;
  lines.push('履历：');
  for (const event of events) lines.push('- ' + event);
}
async function readEntity(input, tsian, signal) {
  if (!isRecord(input)) fail('READ_ENTITY_INVALID_ARGS', 'input must be an object.', { input: input });
  const parsed = parseRef(input.ref);
  const path = 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') fail('READ_ENTITY_NOT_FOUND', 'Entity file not found.', { ref: input.ref, path: path });
  let entity;
  try { entity = JSON.parse(file.content); } catch (e) { fail('READ_ENTITY_JSON_INVALID', 'Entity file is not valid JSON.', { path: path }); }
  if (!isRecord(entity)) fail('READ_ENTITY_INVALID', 'Entity must be a JSON object.', { path: path });
  const lines = [];
  const name = entity.name || entity.id || input.ref;
  lines.push(name + '（' + (entity.id || input.ref) + '）');
  pushPart(lines, '简述', entity.brief);
  formatIdentity(entity.identity, lines);
  pushPart(lines, '外貌', entity.appearance);
  formatAttributes(entity.attributes, lines);
  formatGauges(entity.gauges, lines);
  formatStatus(entity.status, lines);
  formatTraits(entity.traits, lines);
  formatGoals(entity.goals, lines);
  formatHistory(entity.history, lines);
  pushPart(lines, '背景', entity.background);
  const text = lines.join('\n');
  tsian.trace('read_entity', { ref: input.ref, path: path, length: text.length });
  return { text: text };
}
return readEntity(input, tsian, signal);
