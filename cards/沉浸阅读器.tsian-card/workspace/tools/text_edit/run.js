const SAVE_PREFIX = 'save/';
// memory 文件的条目格式提示：校验失败时随错误返回，供调用方一次改对。
const MEMORY_FORMAT_HINT = {
  records: {
    expectedFormat: '- [序号] <recall|scene|npc_action> 关键词: <简短关键词>; 摘要: <一句客观事实>',
    example: '- [1] recall 关键词: 王有信饶命; 摘要: 萧凌饶王有信一命，令其带话给萧瑞。',
  },
  seeds: {
    expectedFormat: '- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: <整数>',
    example: '- [王有信带话回萧瑞] 状态: planted; 关联回合: 1',
  },
};

function isRecord(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function okError(code, message, details) {
  return { code: code, message: 'text_edit: ' + message, details: details || {} };
}
function fail(code, message, details) {
  throw okError(code, message, details);
}
function throwIfAborted(signal) {
  if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
}
function assertSafeTarget(target) {
  if (typeof target !== 'string' || !target.startsWith(SAVE_PREFIX) || target !== target.trim()) {
    fail('TEXT_EDIT_TARGET_INVALID', 'target must be a save/... path without surrounding whitespace.', { target: target });
  }
  if (target.includes('\0') || target.includes('\\')) fail('TEXT_EDIT_TARGET_INVALID', 'target must not contain NUL or backslashes.', { target: target });
  const parts = target.split('/');
  if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
    fail('TEXT_EDIT_TARGET_INVALID', 'target must not contain empty or traversal segments.', { target: target });
  }
}
function normalizeOps(input) {
  if (!isRecord(input)) fail('TEXT_EDIT_INPUT_INVALID', 'input must be an object.', { input: input });
  if (hasOwn(input, 'ops')) {
    if (!Array.isArray(input.ops) || input.ops.length === 0) fail('TEXT_EDIT_OPS_INVALID', 'ops must be a non-empty array.', { ops: input.ops });
    const otherKeys = Object.keys(input).filter(function (key) { return key !== 'ops' && key !== 'target'; });
    if (otherKeys.length > 0) fail('TEXT_EDIT_OPS_INVALID', 'ops cannot be combined with single-operation fields.', { keys: otherKeys });
    const outerTarget = hasOwn(input, 'target') ? input.target : undefined;
    return input.ops.map(function (op, index) {
      if (!isRecord(op)) return op;
      const child = Object.assign({}, op);
      if (outerTarget !== undefined) {
        if (hasOwn(child, 'target') && child.target !== outerTarget) {
          fail('TEXT_EDIT_TARGET_CONFLICT', 'Child target conflicts with outer target.', { opIndex: index, target: child.target, outerTarget: outerTarget });
        }
        if (!hasOwn(child, 'target')) child.target = outerTarget;
      }
      return child;
    });
  }
  return [input];
}
function validateOp(op, opIndex) {
  if (!isRecord(op)) fail('TEXT_EDIT_OP_INVALID', 'Each op must be an object.', { opIndex: opIndex });
  const allowed = new Set(['target', 'create', 'append', 'replace', 'remove']);
  const keys = Object.keys(op);
  for (const key of keys) {
    if (!allowed.has(key)) fail('TEXT_EDIT_OP_INVALID', 'Unknown op field.', { opIndex: opIndex, field: key });
  }
  if (!keys.some(function (key) { return key !== 'target'; })) fail('TEXT_EDIT_OP_EMPTY', 'Operation must include at least one edit field.', { opIndex: opIndex });
  assertSafeTarget(op.target);
  if (op.create !== undefined && typeof op.create !== 'string') fail('TEXT_EDIT_CREATE_INVALID', 'create must be a string.', { opIndex: opIndex });
  if (op.append !== undefined && (!Array.isArray(op.append) || op.append.some(function (line) { return typeof line !== 'string'; }))) {
    fail('TEXT_EDIT_APPEND_INVALID', 'append must be an array of strings.', { opIndex: opIndex });
  }
  if (op.replace !== undefined) {
    if (!Array.isArray(op.replace)) fail('TEXT_EDIT_REPLACE_INVALID', 'replace must be an array.', { opIndex: opIndex });
    for (let i = 0; i < op.replace.length; i++) {
      const entry = op.replace[i];
      if (!isRecord(entry) || typeof entry.find !== 'string' || !entry.find || typeof entry.line !== 'string') {
        fail('TEXT_EDIT_REPLACE_INVALID', 'replace entries must be {find,line} with a non-empty find.', { opIndex: opIndex, index: i });
      }
    }
  }
  if (op.remove !== undefined && (!Array.isArray(op.remove) || op.remove.some(function (find) { return typeof find !== 'string' || !find; }))) {
    fail('TEXT_EDIT_REMOVE_INVALID', 'remove must be an array of non-empty strings.', { opIndex: opIndex });
  }
}
function isNotFound(error) {
  return error && (error.code === 'WORKSPACE_FILE_NOT_FOUND' || error.code === 'FILE_NOT_FOUND');
}
async function readExistingText(tsian, path) {
  try {
    const file = await tsian.workspace.read({ scope: 'effective', path: path });
    if (!file || typeof file.content !== 'string') return null;
    return file.content;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
function splitLines(content) {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : '';
}
function memoryKind(path) {
  if (path === 'save/memory/records.md') return 'records';
  if (path === 'save/memory/seeds.md') return 'seeds';
  return null;
}
function parseRecordLine(line) {
  const match = /^- \[(\d+)\] (recall|scene|npc_action) 关键词: ([^;\n]+); 摘要: (.+)$/.exec(line);
  if (!match) return null;
  return { index: Number(match[1]), fingerprint: match[2] + '\u0000' + match[3].trim() + '\u0000' + match[4].trim() };
}
function parseSeedLine(line) {
  const match = /^- \[([^\]\n]+)\] 状态: (planted|developing|resolved|abandoned); 关联回合: (\d+)$/.exec(line);
  if (!match) return null;
  return { label: match[1].trim(), status: match[2], turn: Number(match[3]) };
}
function isRecordEntryCandidate(line) {
  return /^- \[\d+\]/.test(line);
}
function isSeedEntryCandidate(line) {
  return /^- \[[^\]\n]+\] 状态: /.test(line);
}
function assertMemoryOperationLines(path, op) {
  const kind = memoryKind(path);
  if (!kind) return;
  const parser = kind === 'records' ? parseRecordLine : parseSeedLine;
  const invalidCode = kind === 'records' ? 'TEXT_EDIT_RECORD_FORMAT_INVALID' : 'TEXT_EDIT_SEED_FORMAT_INVALID';
  const hint = MEMORY_FORMAT_HINT[kind];
  const sources = [];
  if (Array.isArray(op.append)) sources.push.apply(sources, op.append);
  if (Array.isArray(op.replace)) {
    for (const entry of op.replace) sources.push(entry.line);
  }
  for (let index = 0; index < sources.length; index += 1) {
    if (!parser(sources[index])) {
      fail(invalidCode, path.split('/').pop() + ' edit line ' + (index + 1) + ' does not match the required entry format.', {
        path: path,
        editLine: index + 1,
        received: sources[index],
        expectedFormat: hint.expectedFormat,
        example: hint.example,
      });
    }
  }
}
// 校验合并后的完整文件。只统计可解析的条目；文件既有的非法行跳过而不阻断本次写入，
// 本次提交的行已由 assertMemoryOperationLines 严格校验。
function validateMemoryLines(path, lines) {
  const kind = memoryKind(path);
  if (!kind) return;
  if (kind === 'records') {
    const fingerprints = new Set();
    let previous = null;
    for (let i = 0; i < lines.length; i++) {
      if (!isRecordEntryCandidate(lines[i])) continue;
      const parsed = parseRecordLine(lines[i]);
      if (!parsed) continue;
      const expected = previous === null ? 1 : previous + 1;
      if (parsed.index !== expected) fail('TEXT_EDIT_RECORD_SEQUENCE_INVALID', 'records.md indexes must increase by one from the current tail.', { path: path, line: i + 1, expected: expected, actual: parsed.index });
      if (fingerprints.has(parsed.fingerprint)) fail('TEXT_EDIT_RECORD_DUPLICATE', 'records.md already contains the same record.', { path: path, line: i + 1 });
      fingerprints.add(parsed.fingerprint);
      previous = parsed.index;
    }
    return;
  }
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!isSeedEntryCandidate(lines[i])) continue;
    const parsed = parseSeedLine(lines[i]);
    if (!parsed) continue;
    if (seen.has(parsed.label)) {
      const previous = seen.get(parsed.label);
      if (previous.status !== parsed.status || previous.turn !== parsed.turn) {
        fail('TEXT_EDIT_SEED_TRANSITION_INVALID', 'A seed may have only one current line; replace its existing line instead of appending a transition.', { path: path, line: i + 1, label: parsed.label });
      }
      fail('TEXT_EDIT_SEED_DUPLICATE', 'seeds.md already contains the same seed.', { path: path, line: i + 1, label: parsed.label });
    }
    seen.set(parsed.label, parsed);
  }
}
function validateSeedTransitions(beforeLines, afterLines, path) {
  if (memoryKind(path) !== 'seeds') return;
  const before = new Map();
  for (const line of beforeLines) {
    const parsed = parseSeedLine(line);
    if (parsed) before.set(parsed.label, parsed.status);
  }
  const allowed = {
    planted: new Set(['developing', 'resolved', 'abandoned']),
    developing: new Set(['resolved', 'abandoned']),
    resolved: new Set(),
    abandoned: new Set(),
  };
  for (let i = 0; i < afterLines.length; i++) {
    const parsed = parseSeedLine(afterLines[i]);
    if (!parsed) continue;
    const previous = before.get(parsed.label);
    if (previous && previous !== parsed.status && !allowed[previous].has(parsed.status)) {
      fail('TEXT_EDIT_SEED_TRANSITION_INVALID', 'Seed status transition is not allowed.', { path: path, line: i + 1, label: parsed.label, from: previous, to: parsed.status });
    }
  }
}
// 采集 memory 文件的规模与脏行观测值，写入 trace。
// entryCount / charCount / closedCount 供开发者判断是否触达分片阈值；skippedLines 暴露文件中的既有非法行。
function collectMemoryStats(path, lines) {
  const kind = memoryKind(path);
  if (!kind) return null;
  const parser = kind === 'records' ? parseRecordLine : parseSeedLine;
  const isCandidate = kind === 'records' ? isRecordEntryCandidate : isSeedEntryCandidate;
  let entryCount = 0;
  let skippedLines = 0;
  let closedCount = 0;
  for (const line of lines) {
    if (!isCandidate(line)) continue;
    const parsed = parser(line);
    if (!parsed) {
      skippedLines += 1;
      continue;
    }
    entryCount += 1;
    if (kind === 'seeds' && (parsed.status === 'resolved' || parsed.status === 'abandoned')) closedCount += 1;
  }
  const stats = { path: path, kind: kind, entryCount: entryCount, charCount: joinLines(lines).length, skippedLines: skippedLines };
  if (kind === 'seeds') stats.closedCount = closedCount;
  return stats;
}
function findLine(lines, find, opIndex, action, index) {
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(find)) matches.push(i);
  }
  if (matches.length === 0) fail('TEXT_EDIT_FIND_NOT_FOUND', action + ' find matched no line.', { opIndex: opIndex, index: index, find: find });
  if (matches.length > 1) fail('TEXT_EDIT_FIND_AMBIGUOUS', action + ' find matched more than one line.', { opIndex: opIndex, index: index, find: find, matchCount: matches.length });
  return matches[0];
}
function applyTextEdits(content, op, opIndex) {
  const beforeLines = splitLines(content);
  const lines = beforeLines.slice();
  const changedLines = [];
  assertMemoryOperationLines(op.target, op);
  if (Array.isArray(op.replace)) {
    for (let i = 0; i < op.replace.length; i++) {
      const lineIndex = findLine(lines, op.replace[i].find, opIndex, 'replace', i);
      if (lines[lineIndex] !== op.replace[i].line) {
        lines[lineIndex] = op.replace[i].line;
        changedLines.push(lineIndex + 1);
      }
    }
  }
  if (Array.isArray(op.remove)) {
    for (let i = 0; i < op.remove.length; i++) {
      const lineIndex = findLine(lines, op.remove[i], opIndex, 'remove', i);
      lines.splice(lineIndex, 1);
      changedLines.push(lineIndex + 1);
    }
  }
  if (Array.isArray(op.append)) {
    for (let i = 0; i < op.append.length; i++) {
      lines.push(op.append[i]);
      changedLines.push(lines.length);
    }
  }
  validateMemoryLines(op.target, lines);
  validateSeedTransitions(beforeLines, lines, op.target);
  return { content: joinLines(lines), changedLines: changedLines };
}
function isToolError(error) {
  return !!(error && typeof error.code === 'string' && error.message);
}
function isOperationError(error) {
  return isToolError(error) && (error.code.indexOf('TEXT_EDIT_') === 0 || error.code === 'WORKSPACE_EXPECTED_CONTENT_MISMATCH');
}
function isRetryableError(error) {
  return isToolError(error) && (error.code.indexOf('TEXT_EDIT_') === 0 || error.code === 'WORKSPACE_EXPECTED_CONTENT_MISMATCH');
}
function errorResult(error, opIndex, target, status) {
  const details = error && isRecord(error.details) ? error.details : {};
  const result = {
    opIndex: opIndex,
    target: target,
    path: target,
    status: status || 'failed',
    code: error && error.code || 'TEXT_EDIT_OPERATION_FAILED',
    message: error && error.message || 'text_edit operation failed.',
    retryable: isRetryableError(error),
  };
  const hint = details.path || details.line || details.find || details.expected || details.label;
  if (hint !== undefined) result.correction = { focus: hint };
  if (Object.keys(details).length) result.details = details;
  return result;
}
function normalizationFailureResults(input, error) {
  const rawOps = isRecord(input) && Array.isArray(input.ops) ? input.ops : [input];
  const failedIndex = error && error.details && Number.isInteger(error.details.opIndex) ? error.details.opIndex : 0;
  return rawOps.map(function (op, index) {
    const target = isRecord(op) && op.target !== undefined ? op.target : isRecord(input) ? input.target : undefined;
    if (index === failedIndex) return errorResult(error, index, target);
    const skipped = errorResult(error, index, target, 'not_run');
    skipped.code = 'TEXT_EDIT_INPUT_REJECTED';
    skipped.message = 'text_edit: operation was not run because the input shape is invalid.';
    skipped.details = { failedOpIndex: failedIndex };
    return skipped;
  });
}
function markNotRun(results, group, reason) {
  for (const entry of group) {
    if (results[entry.index]) continue;
    results[entry.index] = errorResult(reason, entry.index, entry.op.target, 'not_run');
    results[entry.index].code = 'TEXT_EDIT_TARGET_BATCH_ABORTED';
    results[entry.index].message = 'text_edit: target batch was not committed because another operation failed.';
    results[entry.index].retryable = isRetryableError(reason);
    results[entry.index].details = { failedOpIndex: reason && reason.details && reason.details.opIndex };
  }
}
function operationResult(op, opIndex, applied, before, created) {
  const changed = created || applied.content !== before;
  return {
    opIndex: opIndex,
    target: op.target,
    path: op.target,
    status: changed ? 'applied' : 'noop',
    code: changed ? 'TEXT_EDIT_APPLIED' : 'TEXT_EDIT_NOOP',
    message: changed ? 'text_edit: operation applied.' : 'text_edit: operation made no change.',
    retryable: false,
    changed: changed,
    changedLines: changed ? applied.changedLines : [],
  };
}
async function applyTargetGroup(group, results, tsian, signal, memoryStats) {
  const first = group[0];
  throwIfAborted(signal);
  let existing;
  try {
    existing = await readExistingText(tsian, first.op.target);
  } catch (error) {
    if (!isOperationError(error)) throw error;
    results[first.index] = errorResult(error, first.index, first.op.target);
    markNotRun(results, group.slice(1), error);
    return;
  }
  let base;
  let created = false;
  if (existing === null) {
    if (first.op.create === undefined) {
      const error = okError('TEXT_EDIT_TARGET_NOT_FOUND', 'Target text file does not exist; pass create to create it.', { opIndex: first.index, target: first.op.target });
      results[first.index] = errorResult(error, first.index, first.op.target);
      markNotRun(results, group.slice(1), error);
      return;
    }
    base = first.op.create;
    created = true;
  } else {
    base = existing;
  }
  let staged = base;
  const pending = [];
  for (const entry of group) {
    const op = entry.op;
    try {
      validateOp(op, entry.index);
      if (existing !== null && op.create !== undefined) fail('TEXT_EDIT_CREATE_EXISTS', 'Target text file already exists; create is only for missing files.', { opIndex: entry.index, target: op.target });
      if (created && entry.index !== first.index && op.create !== undefined) fail('TEXT_EDIT_CREATE_REPEATED', 'create may only appear in the first operation for a missing target.', { opIndex: entry.index, target: op.target });
      const before = staged;
      const applied = applyTextEdits(staged, op, entry.index);
      staged = applied.content;
      pending.push({ entry: entry, result: operationResult(op, entry.index, applied, before, created && entry.index === first.index) });
    } catch (error) {
      if (!isOperationError(error)) throw error;
      results[entry.index] = errorResult(error, entry.index, op && op.target);
      const abortReason = Object.assign({}, error, { details: Object.assign({}, error.details || {}, { opIndex: entry.index }) });
      for (const prior of pending) {
        if (prior.result.status === 'noop') results[prior.entry.index] = prior.result;
        else {
          results[prior.entry.index] = errorResult(abortReason, prior.entry.index, prior.entry.op.target, 'not_run');
          results[prior.entry.index].code = 'TEXT_EDIT_TARGET_BATCH_ABORTED';
          results[prior.entry.index].message = 'text_edit: target batch was not committed because another operation failed.';
        }
      }
      markNotRun(results, group.filter(function (item) { return item.index !== entry.index && !results[item.index]; }), abortReason);
      return;
    }
  }
  const changed = created || staged !== base;
  if (!changed) {
    for (const item of pending) {
      item.result.status = 'noop';
      item.result.code = 'TEXT_EDIT_NOOP';
      item.result.changed = false;
      item.result.changedLines = [];
      item.result.message = 'text_edit: target returned to its original content.';
    }
  }
  if (changed) {
    throwIfAborted(signal);
    try {
      await tsian.workspace.write({
        scope: 'save-runtime',
        path: first.op.target,
        content: staged,
        mediaType: 'text/plain;charset=utf-8',
        expectedContent: existing === null ? undefined : existing,
      });
    } catch (error) {
      if (!isOperationError(error)) throw error;
      const failed = group[group.length - 1];
      results[failed.index] = errorResult(error, failed.index, failed.op.target);
      markNotRun(results, group.filter(function (item) { return item.index !== failed.index; }), error);
      return;
    }
  }
  const stats = collectMemoryStats(first.op.target, splitLines(staged));
  if (stats && Array.isArray(memoryStats)) memoryStats.push(stats);
  for (const item of pending) results[item.entry.index] = item.result;
}
async function textEdit(input, tsian, signal) {
  let ops;
  try {
    ops = normalizeOps(input);
  } catch (error) {
    if (!isOperationError(error)) throw error;
    const results = normalizationFailureResults(input, error);
    return { status: 'failed', results: results, errors: results, error: results.find(function (item) { return item.status === 'failed'; }) || results[0] };
  }
  const results = [];
  const groups = [];
  const memoryStats = [];
  const byTarget = new Map();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (!isRecord(op)) fail('TEXT_EDIT_OP_INVALID', 'Each op must be an object.', { opIndex: i });
      assertSafeTarget(op.target);
    } catch (error) {
      if (!isOperationError(error)) throw error;
      results[i] = errorResult(error, i, op && op.target);
      continue;
    }
    let group = byTarget.get(op.target);
    if (!group) {
      group = [];
      byTarget.set(op.target, group);
      groups.push(group);
    }
    group.push({ index: i, op: op });
  }
  for (const group of groups) await applyTargetGroup(group, results, tsian, signal, memoryStats);
  for (let i = 0; i < ops.length; i++) {
    if (!results[i]) results[i] = errorResult(okError('TEXT_EDIT_NOT_RUN', 'Operation was not executed.', { opIndex: i }), i, ops[i] && ops[i].target, 'not_run');
  }
  const failures = results.filter(function (item) { return item.status === 'failed' || item.status === 'not_run'; });
  const result = {
    status: failures.length ? (results.some(function (item) { return item.status === 'applied' || item.status === 'noop'; }) ? 'partial_failed' : 'failed') : 'ok',
    results: results,
  };
  if (failures.length) {
    result.errors = failures;
    result.error = failures.find(function (item) { return item.status === 'failed'; }) || failures[0];
  }
  const traceDetail = { opCount: ops.length, changedCount: results.filter(function (item) { return item.status === 'applied'; }).length, failedCount: failures.length };
  if (memoryStats.length) traceDetail.memory = memoryStats;
  tsian.trace('text_edit', traceDetail);
  return result;
}
return textEdit(input, tsian, signal);
