async function publishOpening(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_PUBLISH_INVALID', 'Publish input must be an object.');
    const status = await openingStatus(tsian);
    const authority = await openingSessionAuthority(tsian);
    const playerTurnAgentId = await openingPlayerTurnAgent(tsian);
    const playerContextPath = 'save/agents/' + playerTurnAgentId + '/context.json';
    const runtime = status.runtime;
    const frontier = await openingOptionalJson(tsian, OPENING_FRONTIER_PATH);
    if (!isRecord(runtime) || runtime.turn !== 0 || !isRecord(frontier) || !isRecord(frontier.sourceWindow)
      || !Number.isSafeInteger(frontier.sourceWindow.start) || !Number.isSafeInteger(frontier.sourceWindow.end)
      || !Array.isArray(frontier.timeline) || !frontier.timeline.some(function (anchor) { return isRecord(anchor) && anchor.kind === 'source'; })) {
      fail('OPENING_STATE_NOT_READY', 'Committed opening runtime/frontier state is missing or invalid.');
    }
    const entities = await openingLoadEntities(tsian);
    const scenes = await openingLoadScenes(tsian);
    openingAuthorityRef(runtime.protagonistRef, 'Runtime protagonist', entities.byId, 'character');
    openingAuthorityRef(runtime.location, 'Runtime location', entities.byId, 'location');
    if (!Array.isArray(runtime.activeSceneRefs) || runtime.activeSceneRefs.length === 0) fail('OPENING_STATE_NOT_READY', 'Runtime active scenes are required.');
    const activeScenes = runtime.activeSceneRefs.map(function (raw) { return openingAuthorityRef(raw, 'Runtime active scene', scenes.byId, 'scene'); });
    for (const active of activeScenes) {
      const scene = scenes.byId.get(active.ref).value;
      openingAuthorityRef(scene.location, 'Active scene location', entities.byId, 'location');
      if (!Array.isArray(scene.present) || scene.present.length === 0) fail('OPENING_SCENE_PRESENT_REQUIRED', 'Active scene present must be non-empty.', { scene: active.ref });
      for (const present of scene.present) openingAuthorityRef(present, 'Active scene present', entities.byId);
    }
    if (status.complete) {
      const turn0 = await openingOptionalJson(tsian, OPENING_TURN_ZERO_PATH);
      const playerContext = await openingOptionalJson(tsian, playerContextPath);
      if (!isRecord(turn0) || !isRecord(playerContext)) {
        fail('OPENING_COMPLETE_STATE_INVALID', 'Completed setup is missing turn 0 or player context.', { turn0: !!turn0, playerContext: !!playerContext });
      }
      return { status: 'complete', alreadyComplete: true, writes: [] };
    }
    const existingPlayerContexts = await openingGlob(tsian, 'save/agents/' + playerTurnAgentId + '/context*.json', 'OPENING_PLAYER_CONTEXT_GLOB_TRUNCATED');
    if (existingPlayerContexts.length > 0) fail('OPENING_PLAYER_CONTEXT_CONFLICT', 'Player-turn context already exists before opening publication.', { paths: existingPlayerContexts });
    const summary = normalizeString(status.setup.summary, 'OPENING_SETUP_SUMMARY_REQUIRED', 'pending setup summary', 2000);
    const projected = await openingProjectReply(tsian, input.openingReply);

    const now = new Date().toISOString();
    const assistantItem = { kind: 'assistant', content: projected.content };
    if (projected.displayContent !== undefined) assistantItem.displayContent = projected.displayContent;
    if (projected.projections !== undefined) assistantItem.projections = projected.projections;
    const turn0Record = {
      schema: 'tsian.airp.history.turn.v2',
      turn: 0,
      createdAt: now,
      source: { kind: 'agent-runtime', entryAgentId: playerTurnAgentId },
      timeline: [assistantItem],
    };
    const playerContext = {
      schema: 'tsian.agent.context.v2',
      saveId: '',
      agentId: playerTurnAgentId,
      sequence: 1,
      summary: null,
      recentTurns: [{ sequence: 1, gameTurn: 0, role: 'assistant', content: projected.content }],
      lastCompressedSequence: null,
      updatedAt: now,
    };
    const completedSummary = { status: 'complete', summary: summary, committedAt: now, enteredPlay: false };
    const turnWrite = await openingWriteJson(tsian, OPENING_TURN_ZERO_PATH, turn0Record);
    const contextWrite = await openingWriteJson(tsian, playerContextPath, playerContext);
    const summaryWrite = await openingWriteJson(tsian, OPENING_SETUP_PATH, completedSummary);
    const writes = [turnWrite.path, contextWrite.path, summaryWrite.path];
    tsian.trace('opening_published', { sessionId: authority.control.session.id, writes: writes });
    tsian.memory.set({ key: 'opening-publish:' + authority.control.session.id, status: 'success', title: 'Opening published', summary: 'Turn 0 and player context were published.', anchors: writes });
    return { status: 'complete', writes: { turn0: turnWrite.path, playerContext: contextWrite.path, setupSummary: summaryWrite.path } };
  } catch (error) {
    tsian.trace('opening_publish_failed', { code: error && error.code || 'OPENING_PUBLISH_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return publishOpening(input, tsian, signal);
