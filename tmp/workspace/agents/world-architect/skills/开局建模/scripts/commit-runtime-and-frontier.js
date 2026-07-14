async function commitRuntimeAndFrontier(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    if (!isRecord(input.runtime)) fail('OPENING_RUNTIME_INVALID', 'runtime must be an object.');
    if (!isRecord(input.frontier)) fail('OPENING_FRONTIER_INVALID', 'frontier must be an object.');
    const writes = [];
    // runtime 校验：activeSceneRefs → glob(save/scenes) + protagonistRef/location → loadExistingEntityIds
    const turn = normalizePositiveInt(input.runtime.turn, 0, 0, 999999);
    const worldTime = typeof input.runtime.worldTime === 'string' ? input.runtime.worldTime.trim() : '';
    const weather = typeof input.runtime.weather === 'string' ? input.runtime.weather.trim() : '';
    const activeSceneRefsRaw = Array.isArray(input.runtime.activeSceneRefs) ? input.runtime.activeSceneRefs : [];
    if (activeSceneRefsRaw.length === 0) fail('OPENING_RUNTIME_ACTIVE_SCENES_REQUIRED', 'runtime.activeSceneRefs must list at least one scene ref.');
    const sceneGlob = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/scenes/*.json', limit: 10000 });
    const sceneMatches = Array.isArray(sceneGlob && sceneGlob.matches) ? sceneGlob.matches : [];
    const knownSceneLocalIds = new Set(sceneMatches.map((p) => p.slice('save/scenes/'.length).replace(/\.json$/, '')));
    const activeSceneRefs = [];
    for (const raw of activeSceneRefsRaw) {
      if (!isRecord(raw)) fail('OPENING_RUNTIME_SCENE_INVALID', 'activeSceneRefs entry must be an object { ref, name }.');
      const parsed = normalizeEntityId(raw.ref, 'Active scene ref');
      if (parsed.type !== 'scene') fail('OPENING_RUNTIME_SCENE_TYPE_INVALID', 'activeSceneRefs entry must use scene:<localId>.', { id: parsed.id });
      if (!knownSceneLocalIds.has(parsed.localId)) fail('OPENING_RUNTIME_SCENE_UNKNOWN', 'activeSceneRefs entry must point to an existing scene file.', { id: parsed.id });
      const name = normalizeString(raw.name, 'OPENING_RUNTIME_SCENE_NAME_REQUIRED', 'Active scene name', 120);
      activeSceneRefs.push({ ref: parsed.id, name });
    }
    const knownEntityIds = await loadExistingEntityIds(tsian);
    let protagonistRef = null;
    if (input.runtime.protagonistRef) {
      if (!isRecord(input.runtime.protagonistRef)) fail('OPENING_RUNTIME_PROTAGONIST_INVALID', 'runtime.protagonistRef must be an object { ref, name }.');
      const parsed = normalizeEntityId(input.runtime.protagonistRef.ref, 'Protagonist ref');
      if (!knownEntityIds.has(parsed.id)) fail('OPENING_RUNTIME_PROTAGONIST_UNKNOWN', 'protagonistRef must point to an existing entity.', { ref: parsed.id });
      const name = normalizeString(input.runtime.protagonistRef.name, 'OPENING_RUNTIME_PROTAGONIST_NAME_REQUIRED', 'Protagonist name', 120);
      protagonistRef = { ref: parsed.id, name };
    }
    let location = null;
    if (input.runtime.location) {
      if (!isRecord(input.runtime.location)) fail('OPENING_RUNTIME_LOCATION_INVALID', 'runtime.location must be an object { ref, name }.');
      const parsed = normalizeEntityId(input.runtime.location.ref, 'Runtime location ref');
      if (!knownEntityIds.has(parsed.id)) fail('OPENING_RUNTIME_LOCATION_UNKNOWN', 'runtime.location must point to an existing entity.', { ref: parsed.id });
      const name = normalizeString(input.runtime.location.name, 'OPENING_RUNTIME_LOCATION_NAME_REQUIRED', 'Runtime location name', 120);
      location = { ref: parsed.id, name };
    }
    const rawExtensions = isRecord(input.runtime.extensions) ? input.runtime.extensions : {};
    const extensions = {};
    for (const key of Object.keys(rawExtensions)) { if (key.trim()) extensions[key] = rawExtensions[key]; }
    const runtimeFile = { turn, worldTime, plotOrder: 1, location, weather, activeSceneRefs, protagonistRef, extensions, updatedAtTurn: turn, updatedBy: 'world-architect' };
    // frontier 校验（先校验再写，避免 runtime 半成品落盘）：sourceWindow.chapters path → loadSource knownPaths
    if (!isRecord(input.frontier.sourceWindow)) fail('OPENING_WINDOW_INVALID', 'frontier.sourceWindow must be an object.');
    const source = await loadSource(tsian);
    const knownPaths = new Set(source.chapters.map((chapter) => chapter.path));
    const window = normalizeWindow(input.frontier.sourceWindow, knownPaths);
    const extractedThrough = typeof input.frontier.extractedThrough === 'string' && input.frontier.extractedThrough.trim() ? input.frontier.extractedThrough.trim() : (window.chapters[window.chapters.length - 1] && window.chapters[window.chapters.length - 1].path) || null;
    if (extractedThrough && !knownPaths.has(extractedThrough)) fail('OPENING_SOURCE_REF_UNKNOWN', 'frontier.extractedThrough must point to an imported chapter file.', { extractedThrough });
    const notes = typeof input.frontier.notes === 'string' && input.frontier.notes.trim() ? input.frontier.notes.trim() : window.reason;
    const timelineRaw = Array.isArray(input.frontier.timeline) ? input.frontier.timeline : [];
    const timeline = timelineRaw.map(function (anchor, index) {
      if (!isRecord(anchor)) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Each timeline anchor must be an object.', { index });
      const chapter = normalizePositiveInt(anchor.chapter, 1, 1, 999999);
      const time = normalizeString(anchor.time, 'OPENING_TIMELINE_TIME_REQUIRED', 'Timeline anchor time', 120);
      const label = normalizeString(anchor.label, 'OPENING_TIMELINE_LABEL_REQUIRED', 'Timeline anchor label', 120);
      return { kind: 'source', order: index + 1, chapter: chapter, time: time, label: label };
    });
    const frontierFile = { sourceWindow: { start: window.startIndex, end: window.endIndex, chapters: window.chapters }, extractedThrough, timeline, notes, updatedAt: new Date().toISOString(), updatedBy: 'world-architect' };
    // 全部校验通过，统一写入 runtime 与 frontier
    const runtimeWrite = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/runtime.json', content: JSON.stringify(runtimeFile, null, 2) + '\n', mediaType: 'application/json' });
    writes.push({ path: runtimeWrite.path, size: runtimeWrite.content.length });
    const frontierWrite = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/frontier.json', content: JSON.stringify(frontierFile, null, 2) + '\n', mediaType: 'application/json' });
    writes.push({ path: frontierWrite.path, size: frontierWrite.content.length });
    tsian.trace('opening_runtime_and_frontier_committed', { turn, activeSceneRefs: activeSceneRefs.map((r) => r.ref), protagonistRef: protagonistRef && protagonistRef.ref, location: location && location.ref, frontierStart: window.startIndex, frontierEnd: window.endIndex, extractedThrough, timelineAnchors: timeline.length, writes: writes.map((w) => w.path) });
    return { status: 'ready', writes };
  } catch (error) {
    tsian.trace('opening_runtime_and_frontier_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitRuntimeAndFrontier(input, tsian, signal);
