// roll_dice：参考 Tool 实现。使用 tsian.lib.random.dice 做骰，返回结构化结果。
// modifier 可传数值或纯数字算术表达式字符串（支持 + - * / ^ 和 sqrt()）。
// 表达式经白名单校验 + Function 构造器严格模式求值，不接受变量名/实体路径/eval。
// count === 1 时判定大成功（自然最大值）/大失败（自然 1），优先于常规 success/winner。
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalidArgs(message, details) {
  const error = new Error('roll_dice: ' + message);
  error.code = 'ROLL_DICE_INVALID_ARGS';
  error.details = details;
  throw error;
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
// 受限表达式求值：白名单只允许数字、+ - * / ^ () . 和 sqrt 关键字与空格。
// ^ → ** (JS 幂运算)，sqrt → Math.sqrt；Function 构造器严格模式无作用域访问，不用 eval。
function evalExpr(expr) {
  if (typeof expr !== 'string') {
    invalidArgs('expression must be a string.', { expr: expr });
  }
  const cleaned = expr.replace(/\s+/g, '');
  if (!cleaned) {
    invalidArgs('expression must not be empty.', { expr: expr });
  }
  if (!/^[\d+\-*/^().sqrt]+$/.test(cleaned)) {
    invalidArgs('expression contains invalid characters (only digits, + - * / ^ ( ) . sqrt and spaces allowed).', { expr: expr });
  }
  const jsExpr = cleaned.replace(/\^/g, '**').replace(/sqrt/g, 'Math.sqrt');
  try {
    const result = Function('"use strict"; return (' + jsExpr + ')')();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      invalidArgs('expression did not evaluate to a finite number.', { expr: expr, result: result });
    }
    return result;
  } catch (e) {
    invalidArgs('expression evaluation failed: ' + (e && e.message || e), { expr: expr });
  }
}
function normalizeModifier(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalidArgs(name + ' must be a finite number.', { modifier: value });
    }
    return value;
  }
  if (typeof value === 'string') {
    if (!value.trim()) {
      invalidArgs(name + ' expression must not be empty.', { modifier: value });
    }
    return evalExpr(value);
  }
  invalidArgs(name + ' must be a number or expression string.', { modifier: value });
}
function rollOnce(config, tsian) {
  const roll = tsian.lib.random.dice({ sides: config.sides, count: config.count, modifier: config.modifier, advantage: config.advantage, disadvantage: config.disadvantage });
  const output = {
    sides: config.sides,
    count: config.count,
    modifier: config.modifier,
    rolls: roll.rolls,
    kept: roll.kept,
    total: roll.total,
  };
  if (config.advantage && !config.disadvantage) output.advantage = true;
  if (config.disadvantage && !config.advantage) output.disadvantage = true;
  // 大成功/大失败：仅 count === 1 时判定，基于 kept[0] 自然骰值（advantage/disadvantage 时 kept 是选中那次）。
  if (config.count === 1 && Array.isArray(roll.kept) && roll.kept.length > 0) {
    const natural = roll.kept[0];
    output.criticalSuccess = natural === config.sides;
    output.criticalFailure = natural === 1;
  }
  return output;
}
async function rollDice(input, tsian) {
  if (!isRecord(input)) {
    invalidArgs('input must be an object.', { input: input });
  }
  const hasDc = hasOwn(input, 'dc') && input.dc !== undefined && input.dc !== null;
  const hasOpposed = hasOwn(input, 'opposed') && input.opposed !== undefined;
  if (hasDc && hasOpposed) {
    invalidArgs('dc and opposed cannot be used together.', { dc: input.dc, opposed: true });
  }
  const sides = Number(input.sides);
  if (!Number.isFinite(sides) || sides < 2) {
    invalidArgs('sides must be an integer >= 2.', { sides: input.sides });
  }
  const count = input.count !== undefined ? Number(input.count) : 1;
  const modifier = normalizeModifier(input.modifier, 0, 'modifier');
  const advantage = Boolean(input.advantage);
  const disadvantage = Boolean(input.disadvantage);
  // advantage + disadvantage 同时为 true 时相互抵消（tsian.lib.random.dice 会忽略两者）。
  const topConfig = { sides: sides, count: count, modifier: modifier, advantage: advantage, disadvantage: disadvantage };
  let opposedConfig = null;
  if (hasOpposed) {
    if (!isRecord(input.opposed)) {
      invalidArgs('opposed must be an object.', { opposed: input.opposed });
    }
    opposedConfig = {
      sides: input.opposed.sides !== undefined ? Number(input.opposed.sides) : sides,
      count: input.opposed.count !== undefined ? Number(input.opposed.count) : count,
      modifier: normalizeModifier(input.opposed.modifier, 0, 'opposed.modifier'),
      advantage: Boolean(input.opposed.advantage),
      disadvantage: Boolean(input.opposed.disadvantage),
    };
  }
  const output = rollOnce(topConfig, tsian);
  if (hasDc) {
    const dc = Number(input.dc);
    if (Number.isFinite(dc)) {
      output.dc = dc;
      // 大成功/大失败优先于常规 dc 判定（仅在 count === 1 时 output 上有这两个字段）。
      if (output.criticalSuccess) output.success = true;
      else if (output.criticalFailure) output.success = false;
      else output.success = output.total >= dc;
    }
  }
  if (opposedConfig) {
    output.opposed = rollOnce(opposedConfig, tsian);
    output.margin = output.total - output.opposed.total;
    // 大成功 vs 大失败 优先于常规 margin 判定；双方同为 crit 或均非 crit 时走常规 margin。
    if (output.criticalSuccess && output.opposed.criticalFailure) {
      output.winner = 'self';
    } else if (output.criticalFailure && output.opposed.criticalSuccess) {
      output.winner = 'opposed';
    } else {
      output.winner = output.margin > 0 ? 'self' : output.margin < 0 ? 'opposed' : 'tie';
    }
  }
  if (typeof input.reason === 'string' && input.reason.trim()) {
    output.reason = input.reason.trim().slice(0, 200);
  }
  const traceData = { sides: sides, count: count, modifier: modifier, total: output.total, kept: output.kept };
  if (output.criticalSuccess !== undefined) traceData.criticalSuccess = output.criticalSuccess;
  if (output.criticalFailure !== undefined) traceData.criticalFailure = output.criticalFailure;
  if (opposedConfig) {
    traceData.opposedTotal = output.opposed.total;
    traceData.margin = output.margin;
    traceData.winner = output.winner;
    if (output.opposed.criticalSuccess !== undefined) traceData.opposedCriticalSuccess = output.opposed.criticalSuccess;
    if (output.opposed.criticalFailure !== undefined) traceData.opposedCriticalFailure = output.opposed.criticalFailure;
  }
  tsian.trace('roll_dice', traceData);
  return output;
}
return rollDice(input, tsian);
