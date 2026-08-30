async function commitOpeningState(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    const authority = await openingMutableAuthority(tsian);
    if (authority.alreadyComplete) return { status: 'complete', alreadyComplete: true, phase: 'state', writes: [] };
    if (!isRecord(input) || !isRecord(input.runtime) || !isRecord(input.frontier) || !isRecord(input.frontier.sourceWindow)) {
      fail('OPENING_STATE_INVALID', 'runtime and frontier.sourceWindow must be objects.');
    }
    const entities = await openingLoadEntities(tsian);
    const scenes = await openingLoadScenes(tsian);
    const protagonistRef = openingAuthorityRef(input.runtime.protagonistRef, 'Runtime protagonist', entities.byId, 'character');
    const location = openingAuthorityRef(input.runtime.location, 'Runtime location', entities.byId, 'location');
    if (!Array.isArray(input.runtime.activeSceneRefs) || input.runtime.activeSceneRefs.length === 0 || input.runtime.activeSceneRefs.length > 32) {
      fail('OPENING_RUNTIME_ACTIVE_SCENES_REQUIRED', 'runtime.activeSceneRefs must be a bounded non-empty array.');
    }
    const activeIds = new Set();
    const activeSceneRefs = input.runtime.activeSceneRefs.map(function (raw) {
      const ref = openingAuthorityRef(raw, 'Runtime active scene', scenes.byId, 'scene');
      if (activeIds.has(ref.ref)) fail('OPENING_RUNTIME_SCENE_DUPLICATE', 'Runtime active scenes must be unique.', { ref: ref.ref });
      activeIds.add(ref.ref);
      return ref;
    });

    const source = authority.source;
    const startIndex = openingInteger(input.frontier.sourceWindow.startIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.startIndex', 1, source.chapters.length);
    const endIndex = openingInteger(input.frontier.sourceWindow.endIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.endIndex', startIndex, source.chapters.length);
    if (endIndex - startIndex + 1 > 64) fail('OPENING_WINDOW_INVALID', 'sourceWindow may include at most 64 chapters.', { startIndex: startIndex, endIndex: endIndex });
    const sourceByIndex = new Map(source.chapters.map(function (chapter) { return [chapter.index, chapter]; }));
    const windowChapters = [];
    for (let chapterIndex = startIndex; chapterIndex <= endIndex; chapterIndex += 1) {
      const chapter = sourceByIndex.get(chapterIndex);
      if (!chapter) fail('OPENING_SOURCE_REF_UNKNOWN', 'Source window chapter is missing.', { chapter: chapterIndex });
      windowChapters.push(compactSourceChapter(chapter));
    }
    if (!Array.isArray(input.frontier.timeline) || input.frontier.timeline.length === 0 || input.frontier.timeline.length > 32) {
      fail('OPENING_TIMELINE_REQUIRED', 'frontier.timeline must be a bounded non-empty array.');
    }
    let previousChapter = startIndex;
    const timeline = input.frontier.timeline.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline anchor must be an object.', { index: index });
      const chapter = openingInteger(raw.chapter, 'OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapter', startIndex, endIndex);
      if (chapter < previousChapter) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapters must be non-decreasing.', { chapter: chapter, previousChapter: previousChapter });
      previousChapter = chapter;
      return {
        kind: 'source',
        order: index + 1,
        chapter: chapter,
        time: normalizeString(raw.time, 'OPENING_TIMELINE_TIME_REQUIRED', 'Timeline time', 120),
        label: normalizeString(raw.label, 'OPENING_TIMELINE_LABEL_REQUIRED', 'Timeline label', 120),
        summary: normalizeString(raw.summary, 'OPENING_TIMELINE_SUMMARY_REQUIRED', 'Timeline summary', 1000),
      };
    });
    const entryAnchorIndex = Number.isSafeInteger(input.frontier.entryAnchorIndex)
      && input.frontier.entryAnchorIndex >= 1
      && input.frontier.entryAnchorIndex <= timeline.length
      ? input.frontier.entryAnchorIndex
      : 1;
    const runtimeFile = {
      ...input.runtime,
      turn: 0,
      worldTime: typeof input.runtime.worldTime === 'string' ? input.runtime.worldTime.trim().slice(0, 120) : '',
      plotOrder: timeline[entryAnchorIndex - 1].order,
      location: location,
      weather: typeof input.runtime.weather === 'string' ? input.runtime.weather.trim().slice(0, 120) : '',
      activeSceneRefs: activeSceneRefs,
      protagonistRef: protagonistRef,
      extensions: isRecord(input.runtime.extensions) ? input.runtime.extensions : {},
      updatedAtTurn: 0,
      updatedBy: 'world-architect',
    };
    const reason = typeof input.frontier.sourceWindow.reason === 'string' && input.frontier.sourceWindow.reason.trim()
      ? input.frontier.sourceWindow.reason.trim()
      : '开局已读来源窗口';
    const frontierFile = {
      ...input.frontier,
      sourceWindow: { start: startIndex, end: endIndex, chapters: windowChapters },
      extractedThrough: sourceRefForChapter(sourceByIndex.get(endIndex)),
      timeline: timeline,
      notes: typeof input.frontier.notes === 'string' && input.frontier.notes.trim() ? input.frontier.notes.trim() : reason,
      updatedAt: new Date().toISOString(),
      updatedBy: 'world-architect',
    };
    delete frontierFile.entryAnchorIndex;
    const summary = normalizeString(input.summary, 'OPENING_SETUP_SUMMARY_REQUIRED', 'summary', 2000);
    const pendingSummary = { status: 'pending', summary: summary };

    const existingFrontier = await openingOptionalJson(tsian, OPENING_FRONTIER_PATH);
    const currentFrontierComparable = isRecord(existingFrontier) ? { ...existingFrontier } : existingFrontier;
    const proposedFrontierComparable = { ...frontierFile };
    if (isRecord(currentFrontierComparable)) delete currentFrontierComparable.updatedAt;
    delete proposedFrontierComparable.updatedAt;
    if (openingJsonEqual(authority.status.runtime, runtimeFile)
      && openingJsonEqual(currentFrontierComparable, proposedFrontierComparable)
      && openingJsonEqual(authority.status.setup, pendingSummary)) {
      return { status: 'ready', alreadyComplete: true, phase: 'state', writes: [] };
    }

    const runtimeWrite = await openingWriteJson(tsian, OPENING_RUNTIME_PATH, runtimeFile);
    const frontierWrite = await openingWriteJson(tsian, OPENING_FRONTIER_PATH, frontierFile);
    const summaryWrite = await openingWriteJson(tsian, OPENING_SETUP_PATH, pendingSummary);
    const writes = [runtimeWrite.path, frontierWrite.path, summaryWrite.path];
    tsian.trace('opening_state_committed', { sessionId: authority.control.session.id, writes: writes, sourceWindow: { start: startIndex, end: endIndex } });
    return { status: 'ready', phase: 'state', writes: writes };
  } catch (error) {
    tsian.trace('opening_state_commit_failed', { code: error && error.code || 'OPENING_STATE_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpeningState(input, tsian, signal);
