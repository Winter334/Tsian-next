// recall_turns：读取 save/history/turns/* 的 meta.recall，按半结构化条件打分并返回少量候选。
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
const MAX_SCAN_TURNS = 2000;
const TOP_RESULTS = 5;
const MAX_EXCERPT_LENGTH = 260;
const WEAK_RESULT_SCORE = 4;
const TOO_BROAD_MATCH_COUNT = 24;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fail(code, message, details) {
  const error = new Error('recall_turns: ' + message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}
function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function normalizeArray(value, field, options) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('RECALL_TURNS_INPUT_INVALID', field + ' must be an array.', { field, value });
  const seen = new Set();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const text = cleanText(value[i]);
    if (!text) continue;
    if (options && options.maxItemLength && text.length > options.maxItemLength) continue;
    if (options && options.validate && !options.validate(text)) continue;
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}
function isEntityRef(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split(':');
  return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]) && !/[\s/\\\0]/.test(parts[0]) && !/[\s/\\\0]/.test(parts[1]);
}
function normalizeInput(input) {
  if (!isRecord(input)) input = {};
  const entities = normalizeArray(input['涉及实体'], '涉及实体', { validate: isEntityRef });
  const eventTypes = normalizeArray(input['事件类型'], '事件类型', { validate: function (text) { return EVENT_TYPE_SET.has(text); } });
  const tags = normalizeArray(input['标签'], '标签', { maxItemLength: 80 });
  const timeClue = cleanText(input['时间线索']);
  if (entities.length === 0 && eventTypes.length === 0 && tags.length === 0 && !timeClue) {
    return { ok: false, reason: 'empty', message: '请至少提供一个有效条件：涉及实体、事件类型、标签或时间线索。', suggestions: ['优先补一个明确实体 ref，如 character:沈璃', '不知道实体 ref 时，用标签写关键物件、承诺、误会或动作', '可补事件类型缩小范围'] };
  }
  return { ok: true, query: { entities: entities, eventTypes: eventTypes, tags: tags, timeClue: timeClue } };
}
function parseTurnNumber(path, parsed) {
  if (isRecord(parsed) && typeof parsed.turn === 'number' && Number.isFinite(parsed.turn)) return parsed.turn;
  const match = /turn-(\d+)\.json$/.exec(path);
  return match ? parseInt(match[1], 10) : 0;
}
function parseJson(content) {
  try { return JSON.parse(content); } catch (_error) { return null; }
}
function normalizeRecall(raw) {
  if (!isRecord(raw)) return null;
  if (raw.schema !== RECALL_SCHEMA) return null;
  const summary = cleanText(raw['摘要']);
  if (!summary) return null;
  const entities = Array.isArray(raw['涉及实体']) ? raw['涉及实体'].map(cleanText).filter(Boolean) : [];
  const eventTypes = Array.isArray(raw['事件类型']) ? raw['事件类型'].map(cleanText).filter(function (item) { return EVENT_TYPE_SET.has(item); }) : [];
  const tags = Array.isArray(raw['标签']) ? raw['标签'].map(cleanText).filter(Boolean) : [];
  const time = cleanText(raw['时间']);
  const plotCoordinate = typeof raw['剧情坐标'] === 'number' && Number.isFinite(raw['剧情坐标']) ? raw['剧情坐标'] : undefined;
  const recall = { schema: raw.schema, '涉及实体': entities, '事件类型': eventTypes, '标签': tags, '摘要': summary };
  if (time) recall['时间'] = time;
  if (plotCoordinate !== undefined) recall['剧情坐标'] = plotCoordinate;
  return recall;
}
function extractTurnText(parsed) {
  if (!isRecord(parsed)) return '';
  if (typeof parsed.assistant === 'string') return parsed.assistant;
  if (!Array.isArray(parsed.timeline)) return '';
  let text = '';
  for (const item of parsed.timeline) {
    if (!isRecord(item)) continue;
    if (item.kind === 'assistant' && typeof item.content === 'string') text = item.content;
  }
  return text;
}
function excerptAround(text, queryTerms) {
  const source = cleanText(text).replace(/\s+/g, ' ');
  if (!source) return '';
  let index = -1;
  for (const term of queryTerms) {
    if (!term || term.length < 2) continue;
    const found = source.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return source.length <= MAX_EXCERPT_LENGTH ? source : source.slice(0, MAX_EXCERPT_LENGTH).trimEnd() + '……';
  const start = Math.max(0, index - 90);
  const end = Math.min(source.length, start + MAX_EXCERPT_LENGTH);
  return (start > 0 ? '……' : '') + source.slice(start, end).trim() + (end < source.length ? '……' : '');
}
function addFrequency(map, values) {
  for (const value of values) {
    map.set(value, (map.get(value) || 0) + 1);
  }
}
function idfWeight(freq, total, min, max) {
  const n = Math.max(1, Number(freq) || 1);
  const t = Math.max(1, total);
  const raw = Math.log((t + 1) / n) + 1;
  return Math.max(min, Math.min(max, raw));
}
function uniqueCharacters(text) {
  const set = new Set();
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    set.add(ch);
  }
  return set;
}
function coverageScore(needle, haystack, cap) {
  const query = cleanText(needle);
  const text = cleanText(haystack);
  if (!query || !text) return 0;
  if (text.includes(query)) {
    return Math.min(cap, 1.5 + Math.min(8, query.length) * 0.45);
  }
  const chars = uniqueCharacters(query);
  if (chars.size === 0) return 0;
  let hit = 0;
  chars.forEach(function (ch) { if (text.includes(ch)) hit++; });
  const ratio = hit / chars.size;
  if (ratio < 0.45) return 0;
  return Math.min(cap, ratio * Math.min(4, Math.max(1, query.length / 2)));
}
function scoreCandidate(candidate, query, frequencies, total) {
  const recall = candidate.recall;
  const matched = [];
  let score = 0;
  const entitySet = new Set(recall['涉及实体']);
  const eventTypeSet = new Set(recall['事件类型']);
  const tagSet = new Set(recall['标签']);
  let entityHits = 0;
  for (const entity of query.entities) {
    if (!entitySet.has(entity)) continue;
    entityHits++;
    const weight = idfWeight(frequencies.entities.get(entity), total, 0.8, 3.8);
    score += 2.2 * weight;
    matched.push('涉及实体:' + entity);
  }
  if (entityHits >= 2) {
    score += 4 + entityHits * 1.5;
    matched.push('多实体组合:' + entityHits);
  }
  for (const eventType of query.eventTypes) {
    if (!eventTypeSet.has(eventType)) continue;
    const weight = idfWeight(frequencies.eventTypes.get(eventType), total, 0.6, 2.2);
    score += 1.4 * weight;
    matched.push('事件类型:' + eventType);
  }
  const tagAndSummaryText = recall['标签'].join(' ') + ' ' + recall['摘要'];
  for (const tag of query.tags) {
    if (tagSet.has(tag)) {
      const weight = idfWeight(frequencies.tags.get(tag), total, 1, 4.2);
      score += 4.8 * weight;
      matched.push('标签:' + tag);
      continue;
    }
    if (recall['摘要'].includes(tag) && tag.length >= 2) {
      score += Math.min(10, 4 + tag.length * 0.6);
      matched.push('摘要:' + tag);
      continue;
    }
    const partial = coverageScore(tag, tagAndSummaryText, 4);
    if (partial > 0) {
      score += partial;
      matched.push('部分匹配:' + tag);
    }
  }
  if (query.timeClue) {
    const timeText = cleanText(recall['时间']);
    if (timeText && timeText.includes(query.timeClue)) {
      score += Math.min(8, 3 + query.timeClue.length * 0.5);
      matched.push('时间:' + query.timeClue);
    } else {
      const partialTime = coverageScore(query.timeClue, timeText + ' ' + recall['摘要'], 3);
      if (partialTime > 0) {
        score += partialTime;
        matched.push('时间部分匹配:' + query.timeClue);
      }
    }
  }
  // 明确的长短语一字不差命中摘要，是强信号，即使它作为标签输入并非 exact 标签。
  for (const phrase of query.tags.concat(query.timeClue ? [query.timeClue] : [])) {
    if (phrase.length >= 5 && recall['摘要'].includes(phrase)) {
      score += Math.min(12, 5 + phrase.length * 0.45);
      const marker = '摘要短语:' + phrase;
      if (!matched.includes(marker)) matched.push(marker);
    }
  }
  // 最近优先只作为微弱 tie-breaker，不盖过精确旧事件。
  score += Math.min(1.5, Math.max(0, candidate.turn) / 10000);
  return { score: score, matched: matched };
}
async function loadCandidates(tsian, signal) {
  signal.throwIfAborted();
  const glob = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/history/turns/turn-*.json', limit: MAX_SCAN_TURNS });
  const paths = Array.isArray(glob && glob.matches) ? glob.matches.slice() : [];
  paths.sort(function (a, b) { return b.localeCompare(a); });
  const candidates = [];
  for (const path of paths) {
    signal.throwIfAborted();
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') continue;
    const parsed = parseJson(file.content);
    if (!isRecord(parsed)) continue;
    const recall = normalizeRecall(isRecord(parsed.meta) ? parsed.meta.recall : null);
    if (!recall) continue;
    candidates.push({ path: path, turn: parseTurnNumber(path, parsed), recall: recall, text: extractTurnText(parsed) });
  }
  return { candidates: candidates, truncated: Boolean(glob && glob.truncated), scanned: paths.length };
}
function buildFrequencies(candidates) {
  const frequencies = { entities: new Map(), eventTypes: new Map(), tags: new Map() };
  for (const candidate of candidates) {
    addFrequency(frequencies.entities, candidate.recall['涉及实体']);
    addFrequency(frequencies.eventTypes, candidate.recall['事件类型']);
    addFrequency(frequencies.tags, candidate.recall['标签']);
  }
  return frequencies;
}
async function recallTurns(input, tsian, signal) {
  const normalized = normalizeInput(input);
  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason, message: normalized.message, suggestions: normalized.suggestions || [] };
  }
  const query = normalized.query;
  const loaded = await loadCandidates(tsian, signal);
  if (loaded.candidates.length === 0) {
    return { ok: true, results: [], message: '没有找到带 meta.recall 的历史 turn。后续回合需要场记维护 turn recall metadata。', scanned: loaded.scanned, truncated: loaded.truncated };
  }
  const frequencies = buildFrequencies(loaded.candidates);
  const scored = [];
  for (const candidate of loaded.candidates) {
    const result = scoreCandidate(candidate, query, frequencies, loaded.candidates.length);
    if (result.score <= 0 || result.matched.length === 0) continue;
    const terms = query.tags.concat(query.timeClue ? [query.timeClue] : []).concat(query.entities);
    scored.push({
      turn: candidate.turn,
      path: candidate.path,
      score: Number(result.score.toFixed(2)),
      matched: result.matched,
      '时间': candidate.recall['时间'] || '',
      '剧情坐标': candidate.recall['剧情坐标'],
      '摘要': candidate.recall['摘要'],
      '涉及实体': candidate.recall['涉及实体'],
      '事件类型': candidate.recall['事件类型'],
      '标签': candidate.recall['标签'],
      excerpt: excerptAround(candidate.text, terms),
    });
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return (b.turn || 0) - (a.turn || 0);
  });
  const weakMatches = scored.filter(function (item) { return item.score < WEAK_RESULT_SCORE; }).length;
  if (scored.length >= TOO_BROAD_MATCH_COUNT && weakMatches / scored.length > 0.6) {
    return {
      ok: false,
      reason: 'conditionTooBroad',
      message: '当前条件命中太多弱相关回合，请补充更精确条件。',
      suggestions: ['增加第二个涉及实体', '加入关键物件/承诺/误会/动作标签', '加入更具体的事件类型或时间线索'],
      candidateCount: scored.length,
      preview: scored.slice(0, 3),
    };
  }
  const results = scored.slice(0, TOP_RESULTS);
  tsian.trace('recall_turns', { resultCount: results.length, candidateCount: loaded.candidates.length, scanned: loaded.scanned, truncated: loaded.truncated, queryEntities: query.entities.length, queryEventTypes: query.eventTypes.length, queryTags: query.tags.length, hasTimeClue: Boolean(query.timeClue) });
  return { ok: true, results: results, candidateCount: scored.length, scanned: loaded.scanned, truncated: loaded.truncated };
}
return recallTurns(input, tsian, signal);
