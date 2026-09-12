const STATE = 'save/playthrough/opening-state.json';
const SETUP = 'save/playthrough/setup-summary.json';
const TURN = 'save/history/turns/turn-000000.json';
function reject(code, message) { throw { code, message }; }
async function read(path) { const file = await tsian.workspace.read({ scope: 'effective', path }); return file ? JSON.parse(file.content) : null; }
async function write(path, value) { await tsian.workspace.write({ scope: 'save-runtime', path, content: JSON.stringify(value, null, 2) + '\n' }); }
try {
  const [state, control, source, setup, turns] = await Promise.all([
    read(STATE), read('save/playthrough/opening-interview.json'), read('save/source/manifest.json'), read(SETUP),
    tsian.workspace.glob({ scope: 'effective', pattern: 'save/history/turns/turn-*.json', limit: 10000 }),
  ]);
  if (!state || !control || state.sessionId !== input.sessionId || control.session.id !== input.sessionId
    || !source || control.source.importedAt !== source.importedAt || control.source.normalizationVersion !== source.normalizationVersion
    || control.source.title !== source.title || control.source.chapterCount !== source.chapterCount) reject('OPENING_SESSION_CHANGED', '当前方案不属于这次小说开局，请重新检查。');
  if (setup?.enteredPlay || turns.truncated || turns.matches.some(path => path !== TURN)) reject('OPENING_PLAY_STARTED', '已经进入正式游玩，不能重新建立开局。');
  if (input.operation === 'confirm') {
    if (!state.proposal || state.proposalId !== input.proposalId) reject('OPENING_PROPOSAL_CHANGED', '方案已更新，请重新查看再确认。');
    if (!state.approved) { state.approved = true; await write(STATE, state); }
    return { phase: state.model ? 'story' : 'model' };
  }
  if (!state.approved || !state.model || state.model.id !== input.modelId) reject('OPENING_MODEL_CHANGED', '初始世界尚未提交或已发生变化，请重新检查。');
  const card = await read('game-card.json');
  const playerAgent = card?.runtime?.entrypoints?.playerTurn;
  if (typeof playerAgent !== 'string' || !/^[A-Za-z0-9_-]+$/.test(playerAgent)) reject('OPENING_ENTRYPOINT_INVALID', '当前卡缺少有效的正文入口。');
  const slot = 'opening-story-' + state.model.id + '-' + (state.storyAttempt || 0);
  const transcript = await read('save/agents/' + playerAgent + '/transcripts/' + slot + '.json');
  const assistant = transcript?.agentId === playerAgent && transcript?.slot === slot ? transcript.entries?.at(-1)?.assistant : null;
  const validAssistant = value => value?.kind === 'assistant' && typeof value.content === 'string' && !!value.content.trim()
    && (value.displayContent === undefined || (typeof value.displayContent === 'string' && !!value.displayContent.trim()))
    && Array.isArray(value.projections?.choices) && value.projections.choices.length > 0 && value.projections.choices.length <= 12
    && value.projections.choices.every(choice => typeof choice === 'string' && !!choice.trim() && choice.length <= 300);
  if (input.operation === 'retry_story') {
    if (state.published || await read(TURN) || !transcript || validAssistant(assistant)) reject('OPENING_RETRY_INVALID', '没有需要重新生成的无效开局正文。');
    state.storyAttempt = (state.storyAttempt || 0) + 1;
    await write(STATE, state);
    return { phase: 'story' };
  }
  if (input.operation === 'publish') {
    const existing = await read(TURN);
    if (existing) {
      if (!state.published) reject('OPENING_TURN_CONFLICT', '已有另一份开局正文，不能覆盖。');
      return { phase: setup?.status === 'complete' ? 'complete' : 'maintenance' };
    }
    if (!validAssistant(assistant)) reject('OPENING_REPLY_INVALID', '开局正文或正式选项格式不完整，请重试生成正文。');
    for (const [path, content] of Object.entries(state.model.files)) {
      const file = await tsian.workspace.read({ scope: 'effective', path });
      if (file?.content !== content) reject('OPENING_FACTS_CHANGED', '写手调用期间初始资料发生变化，未发布这份正文。');
    }
    const contextPath = 'save/agents/' + playerAgent + '/context.json';
    if (await read(contextPath)) reject('OPENING_CONTEXT_EXISTS', '已有正式正文上下文，不能覆盖。');
    const item = { kind: 'assistant', content: assistant.content, ...(assistant.displayContent !== undefined ? { displayContent: assistant.displayContent } : {}), projections: assistant.projections };
    const now = new Date().toISOString();
    await write(TURN, { schema: 'tsian.airp.history.turn.v2', turn: 0, createdAt: now, source: { kind: 'agent-runtime', entryAgentId: playerAgent }, timeline: [item] });
    await write(contextPath, { schema: 'tsian.agent.context.v2', saveId: '', agentId: playerAgent, sequence: 1, summary: null, recentTurns: [{ sequence: 1, gameTurn: 0, role: 'assistant', content: assistant.content }], lastCompressedSequence: null, updatedAt: now });
    state.published = true;
    await write(STATE, state);
    // Still pending: turn zero must receive the same semantic maintenance as later turns.
    return { phase: 'maintenance' };
  }
  if (input.operation === 'finish') {
    const turn = await read(TURN);
    const receipt = turn?.meta?.maintenance;
    if (!state.published || !receipt || receipt.token !== input.maintenanceToken || receipt.source !== JSON.stringify(turn.timeline)) reject('OPENING_MAINTENANCE_REQUIRED', '开局资料尚未整理完成，不能开始正式游玩。');
    if (setup.status !== 'complete') {
      await write(SETUP, { status: 'complete', summary: setup.summary, committedAt: new Date().toISOString(), enteredPlay: false });
      state.complete = true;
      await write(STATE, state);
    }
    return { phase: 'complete' };
  }
  reject('OPENING_OPERATION_INVALID', '未知开局操作。');
} catch (error) {
  if (error && typeof error.code === 'string' && error.code.startsWith('OPENING_')) return tsian.action.fail({ code: error.code, message: error.message });
  throw error;
}
