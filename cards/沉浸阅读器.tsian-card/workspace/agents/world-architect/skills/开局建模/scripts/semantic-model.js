const OPENING_SEMANTIC_STATE = 'save/playthrough/opening-state.json';

function openingValidate(schema, value, label) {
  if (schema.anyOf) {
    if (!schema.anyOf.some(candidate => { try { openingValidate(candidate, value, label); return true; } catch { return false; } })) fail('OPENING_INPUT_INVALID', label + ' 内容类型不合适。');
    return;
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const match = type => type === 'null' ? value === null : type === 'object' ? isRecord(value) : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (types.length && !types.some(match)) fail('OPENING_INPUT_INVALID', label + ' 内容类型不合适。');
  if (schema.enum && !schema.enum.includes(value)) fail('OPENING_INPUT_INVALID', label + ' 选项无效。');
  if (typeof value === 'string' && ((schema.minLength && value.trim().length < schema.minLength) || (schema.maxLength && value.length > schema.maxLength))) fail('OPENING_INPUT_INVALID', label + ' 文字为空或过长。');
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) fail('OPENING_INPUT_INVALID', label + ' 数值超出范围。');
  if (Array.isArray(value)) {
    if ((schema.minItems && value.length < schema.minItems) || (schema.maxItems && value.length > schema.maxItems)) fail('OPENING_INPUT_INVALID', label + ' 条目数量不合适。');
    if (schema.items) value.forEach((item, index) => openingValidate(schema.items, item, label + '[' + index + ']'));
  } else if (isRecord(value)) {
    if (schema.maxProperties && Object.keys(value).length > schema.maxProperties) fail('OPENING_INPUT_INVALID', label + ' 条目过多。');
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) fail('OPENING_INPUT_INVALID', label + ' 缺少 ' + key + '。');
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('OPENING_INPUT_INVALID', label + ' 名称不可用。');
      const property = (schema.properties || {})[key];
      if (!property && schema.additionalProperties === false) fail('OPENING_INPUT_INVALID', label + ' 不接受 ' + key + '；请提交语义资料，不要填写内部字段。');
      if (property || isRecord(schema.additionalProperties)) openingValidate(property || schema.additionalProperties, item, label + '.' + key);
    }
  }
}

async function openingSemantic(operation, input, tsian, signal) {
  signal.throwIfAborted();
  const declaration = await readText(tsian, operation === 'propose_opening' ? 'agents/storyteller/skills/开局访谈/SKILL.md' : 'agents/world-architect/skills/开局建模/SKILL.md');
  const actions = JSON.parse(declaration.match(/```json tsian-actions\s*([\s\S]*?)```/)[1]);
  const action = actions.find(value => value.name === operation);
  if (!action) fail('OPENING_ACTION_INVALID', '未知建模动作。');
  openingValidate(action.inputSchema, input, '开局资料');
  const authority = await openingSessionAuthority(tsian);
  const status = await openingStatus(tsian);
  if (status.complete) fail('OPENING_ALREADY_COMPLETE', '开局已完成，不再替换世界规则。');
  let state = await openingOptionalJson(tsian, OPENING_SEMANTIC_STATE);
  if (state && state.sessionId !== authority.control.session.id) fail('OPENING_SESSION_MISMATCH', '开局方案与当前小说不一致。');
  state = state || { sessionId: authority.control.session.id, proposal: null, approved: false, model: null };
  if (operation === 'propose_opening') {
    if (state.approved || state.model) fail('OPENING_PLAN_CONFIRMED', '玩家已确认方案，请按确认内容建立世界适配。');
    if (!openingJsonEqual(state.proposal, input)) {
      state.proposal = input;
      state.proposalId = crypto.randomUUID();
      await openingWriteJson(tsian, OPENING_SEMANTIC_STATE, state);
    }
    return { status: 'awaiting_confirmation', proposal: state.proposal };
  }
  if (!state.approved || !state.proposal) fail('OPENING_CONFIRMATION_REQUIRED', '请等待玩家通过界面确认方案后再建立世界适配。');
  if (await openingOptionalFile(tsian, OPENING_TURN_ZERO_PATH)) fail('OPENING_STORY_EXISTS', '开局正文已经保存，后续资料由场记维护。');
  if (state.model) {
    const playerAgent = await openingPlayerTurnAgent(tsian);
    const stories = await openingGlob(tsian, 'save/agents/' + playerAgent + '/transcripts/opening-story-' + state.model.id + '-*.json');
    if (stories.length) fail('OPENING_STORY_EXISTS', '写手已有开局输出，后续变化由场记维护。');
  }
  const signature = JSON.stringify(openingCanonical(input));
  const previous = state.model;
  if (previous) {
    for (const [path, content] of Object.entries(previous.files)) {
      if ((await openingOptionalFile(tsian, path))?.content !== content) fail('OPENING_MODEL_CHANGED', '已提交世界规则发生变化，请重新检查，不覆盖其他修改。');
    }
    if (previous.signature === signature) return { status: 'model_ready', alreadyApplied: true, summary: input.summary };
  } else {
    const occupied = await openingGlob(tsian, 'save/entities/*/*.json');
    const scenes = await openingGlob(tsian, 'save/scenes/*.json');
    const relationships = await openingGlob(tsian, 'save/relationships/*.json');
    if (occupied.length || scenes.length || relationships.length) fail('OPENING_MODEL_CONFLICT', '此存档已存在其他世界规则，请使用新测试存档。');
  }
  const docs = new Map();
  const world = input.world, tiers = world.power.tiers, dimensions = world.dimensions;
  if (new Set(tiers).size !== tiers.length || new Set(dimensions.map(value => value.name)).size !== dimensions.length) fail('OPENING_WORLD_INVALID', '阶梯和维度名称不能重复。');
  if (!dimensions.some(value => value.kind === 'growth') || dimensions.filter(value => value.kind === 'talent').length < 2) fail('OPENING_WORLD_INVALID', '至少声明一个成长维和两个天赋维。');
  const ratio = tiers.length > 1 ? { gentle: 4, moderate: 30, steep: 1000 }[world.power.scale] : 1;
  const q = tiers.length > 1 ? Math.pow(ratio, 1 / (tiers.length - 1)) : 1;
  const ranges = tiers.map((tier, index) => '- ' + tier + '：成长基准 ' + Math.round(5 * Math.pow(q, index)) + '；混合基准 ' + Math.round(5 * Math.pow(q, index / 2))).join('\n');
  const rules = '# ' + world.title + '\n\n## 力量体系阶梯\n\n' + (tiers.join(' → ') || '无明确力量阶梯') + '\n\n## 属性档位与区间映射\n\n档位：' + world.power.scale + '\n' + ranges + '\n\n## 维度定义\n\n' + dimensions.map(value => '- ' + value.name + '（' + value.kind + '）：' + value.meaning).join('\n') + '\n\n## 世界观术语与称呼约定\n\n' + (world.terms || '') + '\n' + world.rules.map(rule => '- ' + rule).join('\n') + '\n';
  docs.set('save/schema/current.md', rules);
  docs.set('save/schema/world.json', world);
  docs.set(OPENING_SETUP_PATH, { status: 'pending', summary: input.summary });
  // Replace only this opening's own managed files, never unrelated save assets.
  const files = Object.fromEntries([...docs].map(([path, value]) => [path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n']));
  for (const path of Object.keys(previous?.files || {})) if (!docs.has(path)) await tsian.workspace.delete({ scope: 'save-runtime', path });
  for (const [path, content] of Object.entries(files)) { signal.throwIfAborted(); await tsian.workspace.write({ scope: 'save-runtime', path, content }); }
  state.model = { id: crypto.randomUUID(), signature, files };
  await openingWriteJson(tsian, OPENING_SEMANTIC_STATE, state);
  return { status: 'model_ready', summary: input.summary };
}
