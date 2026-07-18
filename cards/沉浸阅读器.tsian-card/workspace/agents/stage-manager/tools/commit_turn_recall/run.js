// commit_turn_recall：只写入目标 turn 文件的 meta.recall，不修改 turn timeline 正文。
const RECALL_SCHEMA = '沉浸阅读器.turn-recall.v1';
const EVENT_TYPES = [
  '对话交流',
  '玩家选择',
  '冲突争执',
  '关系变化',
  '承诺亏欠',
  '秘密揭露',
  '发现线索',
  '物品变化',
  '状态变化',
  '场景变化',
  '战斗危险',
  '计划目标',
  '交易谈判',
  '亲密暧昧',
  '伏笔回收',
];
const EVENT_TYPE_SET = new Set(EVENT_TYPES);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fail(code, message, details) {
  const error = new Error('commit_turn_recall: ' + message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}
function parseJson(content, path) {
  try {
    return JSON.parse(content);
  } catch (error) {
    fail('TURN_RECALL_TURN_JSON_INVALID', 'target turn file is not valid JSON.', { path, message: error && error.message || String(error) });
  }
}
function formatTurnPath(turn) {
  return 'save/history/turns/turn-' + String(turn).padStart(6, '0') + '.json';
}
async function findMaxTurn(tsian, signal) {
  signal.throwIfAborted();
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/history/turns/turn-*.json', limit: 10000 });
  const matches = Array.isArray(result && result.matches) ? result.matches : [];
  let max = 0;
  for (const path of matches) {
    const match = /turn-(\d+)\.json$/.exec(path);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}
async function readTurnFile(tsian, turn, signal) {
  const path = formatTurnPath(turn);
  signal.throwIfAborted();
  const file = await tsian.workspace.read({ scope: 'effective', path: path });
  if (!file || typeof file.content !== 'string') {
    fail('TURN_RECALL_TURN_NOT_FOUND', 'target turn file was not found.', { path, turn });
  }
  return { path: path, content: file.content, parsed: parseJson(file.content, path) };
}
function normalizeTurn(value) {
  if (value === undefined || value === null || value === '') return 0;
  const turn = Number(value);
  if (!Number.isFinite(turn) || turn <= 0) {
    fail('TURN_RECALL_TURN_INVALID', 'turn must be a positive number when provided.', { turn: value });
  }
  return Math.floor(turn);
}
function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    fail('TURN_RECALL_FIELD_INVALID', field + ' must be a string when present.', { field, value });
  }
  const text = value.trim();
  if (!text) return undefined;
  if (maxLength && text.length > maxLength) {
    fail('TURN_RECALL_FIELD_TOO_LONG', field + ' is too long.', { field, maxLength, length: text.length });
  }
  return text;
}
function normalizePlotCoordinate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    fail('TURN_RECALL_PLOT_COORDINATE_INVALID', '剧情坐标 must be a finite number when present.', { value });
  }
  return n;
}
function normalizeEntityRef(value, index) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('TURN_RECALL_ENTITY_REF_INVALID', '涉及实体 entries must be non-empty strings.', { index, value });
  }
  const ref = value.trim();
  const parts = ref.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /[\s/\\\0]/.test(parts[0]) || /[\s/\\\0]/.test(parts[1])) {
    fail('TURN_RECALL_ENTITY_REF_INVALID', '涉及实体 must use <type>:<localId> without whitespace or path separators.', { index, ref });
  }
  return parts[0] + ':' + parts[1];
}
function normalizeStringArray(value, field, options) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail('TURN_RECALL_ARRAY_INVALID', field + ' must be an array.', { field, value });
  }
  const seen = new Set();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const text = trimString(value[i]);
    if (!text) continue;
    if (options && options.maxItemLength && text.length > options.maxItemLength) {
      fail('TURN_RECALL_ITEM_TOO_LONG', field + ' item is too long.', { field, index: i, maxLength: options.maxItemLength, length: text.length });
    }
    if (options && options.validate) options.validate(text, i);
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  const maxItems = options && options.maxItems;
  if (maxItems && result.length > maxItems) {
    fail('TURN_RECALL_TOO_MANY_ITEMS', field + ' has too many items.', { field, maxItems, length: result.length });
  }
  return result;
}
function normalizeRecall(input) {
  if (!isRecord(input)) {
    fail('TURN_RECALL_PAYLOAD_INVALID', 'recall must be an object.', { input });
  }
  const schema = input.schema === undefined || input.schema === null || input.schema === '' ? RECALL_SCHEMA : input.schema;
  if (schema !== RECALL_SCHEMA) {
    fail('TURN_RECALL_SCHEMA_INVALID', 'schema must be ' + RECALL_SCHEMA + '.', { schema });
  }
  const entities = normalizeStringArray(input['涉及实体'], '涉及实体', {
    maxItems: 8,
    validate: normalizeEntityRef,
  });
  const eventTypes = normalizeStringArray(input['事件类型'], '事件类型', {
    maxItems: EVENT_TYPES.length,
    validate: function (text, index) {
      if (!EVENT_TYPE_SET.has(text)) {
        fail('TURN_RECALL_EVENT_TYPE_INVALID', '事件类型 must use the approved enum.', { index, value: text, allowed: EVENT_TYPES });
      }
    },
  });
  const tags = normalizeStringArray(input['标签'], '标签', { maxItems: 12, maxItemLength: 30 });
  const summary = normalizeOptionalText(input['摘要'], '摘要', 240);
  if (!summary) {
    fail('TURN_RECALL_SUMMARY_REQUIRED', '摘要 must be a non-empty string.', { field: '摘要' });
  }
  const recall = {
    schema: RECALL_SCHEMA,
    '涉及实体': entities,
    '事件类型': eventTypes,
    '标签': tags,
    '摘要': summary,
  };
  const plotCoordinate = normalizePlotCoordinate(input['剧情坐标']);
  if (plotCoordinate !== undefined) recall['剧情坐标'] = plotCoordinate;
  const time = normalizeOptionalText(input['时间'], '时间', 80);
  if (time) recall['时间'] = time;
  return recall;
}
async function commitTurnRecall(input, tsian, signal) {
  if (!isRecord(input)) input = {};
  const recall = normalizeRecall(input.recall);
  let turn = normalizeTurn(input.turn);
  if (turn === 0) turn = await findMaxTurn(tsian, signal);
  if (turn <= 0) {
    fail('TURN_RECALL_NO_TURN', 'no turn files were found; provide a valid turn after a successful formal turn.', {});
  }
  const target = await readTurnFile(tsian, turn, signal);
  if (!isRecord(target.parsed)) {
    fail('TURN_RECALL_TURN_SHAPE_INVALID', 'target turn JSON must be an object.', { path: target.path });
  }
  const next = { ...target.parsed };
  const oldMeta = isRecord(target.parsed.meta) ? target.parsed.meta : {};
  next.meta = { ...oldMeta, recall: recall };
  signal.throwIfAborted();
  const file = await tsian.workspace.write({
    scope: 'save-runtime',
    path: target.path,
    content: JSON.stringify(next, null, 2) + '\n',
    mediaType: 'application/json',
  });
  tsian.trace('turn_recall_committed', { turn: turn, path: file.path, entityCount: recall['涉及实体'].length, eventTypeCount: recall['事件类型'].length, tagCount: recall['标签'].length });
  return { status: 'written', turn: turn, path: file.path, recall: recall };
}
return commitTurnRecall(input, tsian, signal);
