async function commitOpening(input, tsian, signal) {
  try {
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    let serialized;
    try { serialized = JSON.stringify(input); } catch (error) { fail('OPENING_COMMIT_INVALID', 'Commit input must be JSON serializable.'); }
    if (serialized.length > 256000) fail('OPENING_COMMIT_TOO_LARGE', 'Commit input exceeds the 256000 character limit.', { length: serialized.length });

    function text(value, code, label, maxLength) {
      return normalizeString(value, code, label, maxLength);
    }
    function integer(value, code, label, min, max) {
      if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, label + ' must be a safe integer in range.', { value, min, max });
      return value;
    }
    function fnvHash(value) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    }
    async function optionalFile(path) {
      try {
        return await tsian.workspace.read({ scope: 'effective', path });
      } catch (error) {
        if (error && error.code === 'WORKSPACE_FILE_NOT_FOUND') return null;
        throw error;
      }
    }
    async function optionalJson(path) {
      const file = await optionalFile(path);
      return file && typeof file.content === 'string' ? parseJson(file.content, path) : null;
    }
    async function matches(pattern) {
      const result = await tsian.workspace.glob({ scope: 'effective', pattern, limit: 10000 });
      if (result && result.truncated) fail('OPENING_SAVE_NOT_CLEAN', 'Workspace match limit was exceeded.', { pattern });
      return Array.isArray(result && result.matches) ? result.matches : [];
    }
    async function unexpectedFiles(root) {
      const pending = [root];
      const visited = new Set();
      const found = [];
      while (pending.length) {
        signal.throwIfAborted();
        const path = pending.shift();
        if (visited.has(path)) continue;
        visited.add(path);
        if (visited.size > 512) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory is too large to verify safely.', { root });
        const listing = await tsian.workspace.list({ scope: 'effective', path });
        if (!isRecord(listing) || !Array.isArray(listing.entries)) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory could not be verified.', { path });
        for (const entry of listing.entries) {
          if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.name !== 'string') fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory contains an invalid entry.', { path });
          if (entry.kind === 'directory') pending.push(entry.path);
          else if (entry.kind !== 'file' || (entry.name !== 'README.md' && entry.name !== '.keep')) found.push(entry.path);
          if (found.length > 128) fail('OPENING_SAVE_NOT_CLEAN', 'Formal model directory contains too many existing files.', { root });
        }
      }
      return found;
    }
    function safeAgentId(value) {
      const id = text(value, 'OPENING_PLAYER_TURN_AGENT_REQUIRED', 'playerTurn agent id', 120);
      if (id === '.' || id === '..' || /[\\/\x00-\x1f\x7f]/.test(id)) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent id must be a safe path segment.', { id });
      return id;
    }
    function isPendingRuntime(value) {
      return isRecord(value) && value.turn === 0 && value.worldTime === '' && value.plotOrder === 1 && value.location === null
        && value.weather === '' && Array.isArray(value.activeSceneRefs) && value.activeSceneRefs.length === 0
        && value.protagonistRef === null && isRecord(value.extensions) && Object.keys(value.extensions).length === 0;
    }
    function isPendingFrontier(value) {
      return isRecord(value) && isRecord(value.sourceWindow) && value.sourceWindow.start === null && value.sourceWindow.end === null
        && value.extractedThrough === null && Array.isArray(value.timeline);
    }
    function isPendingUnderstanding(value) {
      return isRecord(value) && value.status === 'pending' && value.title === null
        && Array.isArray(value.candidateCharacters) && value.candidateCharacters.length === 0;
    }
    function isPendingSetup(value) {
      return isRecord(value) && value.status === 'pending' && value.summary === null;
    }
    function targetRef(raw, label, targets, expectedType) {
      if (!isRecord(raw)) fail('OPENING_REF_INVALID', label + ' must be an object with ref.', { label });
      const parsed = normalizeEntityId(raw.ref, label + ' ref');
      const target = targets.get(parsed.id);
      if (parsed.type !== expectedType || !target) fail('OPENING_REF_UNKNOWN', label + ' must point to this commit.', { ref: parsed.id, expectedType });
      return { ref: parsed.id, name: target.name };
    }

    const setupSummary = await optionalJson('save/playthrough/setup-summary.json');
    if (isRecord(setupSummary) && setupSummary.status === 'complete') {
      const completedRuntime = await optionalJson('save/playthrough/runtime.json');
      const completedTurnPaths = await matches('save/history/turns/turn-*.json');
      const progressedTurnPaths = completedTurnPaths.filter(function (path) { return path !== 'save/history/turns/turn-000000.json'; });
      if (setupSummary.enteredPlay === true
        || (isRecord(completedRuntime) && Number.isSafeInteger(completedRuntime.turn) && completedRuntime.turn > 0)
        || progressedTurnPaths.length > 0) {
        fail('OPENING_PLAY_ALREADY_STARTED', 'Formal play has already started; opening commit cannot run again.', {
          enteredPlay: setupSummary.enteredPlay === true,
          runtimeTurn: completedRuntime && completedRuntime.turn,
          progressedTurnPaths,
        });
      }
      return { status: 'complete', alreadyComplete: true, writes: { entities: 0, scenes: 0, relationships: 0 } };
    }

    const source = await loadSource(tsian);
    if (source.chapters.length === 0 || source.manifest.chapterCount !== source.chapters.length
      || typeof source.manifest.importedAt !== 'string' || typeof source.manifest.normalizationVersion !== 'string'
      || typeof source.manifest.title !== 'string' || !source.manifest.title.trim()) {
      fail('OPENING_SOURCE_NOT_READY', 'Imported source manifest and chapter index do not describe the same ready source.');
    }
    const control = await readJson(tsian, 'save/playthrough/opening-interview.json');
    const identity = {
      importedAt: source.manifest.importedAt,
      normalizationVersion: source.manifest.normalizationVersion,
      title: source.manifest.title,
      chapterCount: source.manifest.chapterCount,
    };
    const sourceHash = fnvHash(JSON.stringify(identity));
    if (!isRecord(control) || control.schema !== 'novel-airp.opening-interview.v2' || !isRecord(control.source) || !isRecord(control.session)
      || control.source.hash !== sourceHash || control.source.importedAt !== identity.importedAt
      || control.source.normalizationVersion !== identity.normalizationVersion || control.source.title !== identity.title
      || control.source.chapterCount !== identity.chapterCount || control.session.id !== 'opening-' + sourceHash
      || control.session.slot !== 'opening-interview-' + sourceHash || (control.branch !== 'canon' && control.branch !== 'original')) {
      fail('OPENING_SESSION_MISMATCH', 'Opening control does not match the imported source.');
    }

    if (!Array.isArray(input.entities) || input.entities.length === 0 || input.entities.length > 64) fail('OPENING_ENTITIES_REQUIRED', 'entities must be a bounded non-empty array.');
    const entityById = new Map();
    const writePaths = new Set();
    const entities = input.entities.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_ENTITY_INVALID', 'Each entity must be an object.', { index });
      const parsed = normalizeEntityId(raw.id, 'Entity id');
      if (!['character', 'location', 'container', 'item'].includes(parsed.type)) fail('OPENING_ENTITY_TYPE_INVALID', 'Opening entity type is unsupported.', { id: parsed.id });
      const name = text(raw.name, 'OPENING_ENTITY_NAME_REQUIRED', 'Entity name', 120);
      const brief = text(raw.brief, 'OPENING_ENTITY_BRIEF_REQUIRED', 'Entity brief', 2000);
      const path = 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
      if (entityById.has(parsed.id) || writePaths.has(path)) fail('OPENING_ENTITY_DUPLICATE', 'Duplicate entity id/path.', { id: parsed.id, path });
      const entity = { ...raw, id: parsed.id, name, brief };
      if (parsed.type === 'container') {
        entity.type = 'container';
        if (!Array.isArray(entity.contents)) entity.contents = [];
      }
      if (parsed.type === 'item' && (typeof entity.type !== 'string' || !entity.type.trim())) entity.type = 'other';
      const item = { id: parsed.id, type: parsed.type, name, path, entity };
      entityById.set(parsed.id, item);
      writePaths.add(path);
      return item;
    });

    if (!Array.isArray(input.scenes) || input.scenes.length === 0 || input.scenes.length > 32) fail('OPENING_SCENES_REQUIRED', 'scenes must be a bounded non-empty array.');
    const sceneById = new Map();
    const scenes = input.scenes.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_SCENE_INVALID', 'Each scene must be an object.', { index });
      const parsed = normalizeEntityId(raw.id, 'Scene id');
      if (parsed.type !== 'scene') fail('OPENING_SCENE_TYPE_INVALID', 'Scene id must use scene:<localId>.', { id: parsed.id });
      const name = text(raw.name, 'OPENING_SCENE_NAME_REQUIRED', 'Scene name', 120);
      const location = targetRef(raw.location, 'Scene location', entityById, 'location');
      if (!Array.isArray(raw.present) || raw.present.length === 0 || raw.present.length > 64) fail('OPENING_SCENE_PRESENT_REQUIRED', 'Scene present must be non-empty.', { id: parsed.id });
      const seen = new Set();
      const present = raw.present.map(function (entry) {
        if (!isRecord(entry)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present entries must contain ref.', { id: parsed.id });
        const ref = normalizeEntityId(entry.ref, 'Scene present ref').id;
        if (!entityById.has(ref)) fail('OPENING_REF_UNKNOWN', 'Scene present ref must point to this commit.', { scene: parsed.id, ref });
        if (seen.has(ref)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present refs must be unique.', { scene: parsed.id, ref });
        seen.add(ref);
        return { ref };
      });
      const path = 'save/scenes/' + parsed.localId + '.json';
      if (sceneById.has(parsed.id) || writePaths.has(path)) fail('OPENING_SCENE_DUPLICATE', 'Duplicate scene id/path.', { id: parsed.id, path });
      const scene = { ...raw, id: parsed.id, name, location, present, status: 'active', extensions: isRecord(raw.extensions) ? raw.extensions : {} };
      const item = { id: parsed.id, name, path, scene };
      sceneById.set(parsed.id, item);
      writePaths.add(path);
      return item;
    });

    if (!Array.isArray(input.relationships) || input.relationships.length > 64) fail('OPENING_RELATIONSHIPS_INVALID', 'relationships must be a bounded array.');
    const relationshipSubjects = new Set();
    const relationships = input.relationships.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_RELATIONSHIP_INVALID', 'Each relationship must be an object.', { index });
      const subject = normalizeEntityId(raw.subject, 'Relationship subject');
      if (subject.type !== 'character' || !entityById.has(subject.id)) fail('OPENING_REF_UNKNOWN', 'Relationship subject must be a character in this commit.', { subject: subject.id });
      if (relationshipSubjects.has(subject.id)) fail('OPENING_RELATIONSHIP_DUPLICATE_SUBJECT', 'Relationship subjects must be unique.', { subject: subject.id });
      relationshipSubjects.add(subject.id);
      if (!Array.isArray(raw.edges) || raw.edges.length === 0 || raw.edges.length > 64) fail('OPENING_RELATIONSHIP_EDGES_REQUIRED', 'Relationship edges must be non-empty.', { subject: subject.id });
      const edges = raw.edges.map(function (edge) {
        if (!isRecord(edge)) fail('OPENING_RELATIONSHIP_EDGE_INVALID', 'Relationship edge must be an object.', { subject: subject.id });
        const to = normalizeEntityId(edge.to, 'Relationship target');
        if (to.type !== 'character' || !entityById.has(to.id)) fail('OPENING_REF_UNKNOWN', 'Relationship target must be a character in this commit.', { to: to.id });
        return { to: to.id, type: text(edge.type, 'OPENING_RELATIONSHIP_TYPE_REQUIRED', 'Relationship type', 80), since: Number.isSafeInteger(edge.since) ? edge.since : 0, ...(typeof edge.until === 'number' ? { until: edge.until } : {}), ...(typeof edge.note === 'string' && edge.note.trim() ? { note: edge.note.trim() } : {}) };
      });
      return { path: 'save/relationships/' + subject.localId + '.json', file: { subject: subject.id, edges } };
    });

    if (!isRecord(input.runtime)) fail('OPENING_RUNTIME_INVALID', 'runtime must be an object.');
    const protagonistRef = targetRef(input.runtime.protagonistRef, 'Runtime protagonist', entityById, 'character');
    const location = targetRef(input.runtime.location, 'Runtime location', entityById, 'location');
    if (!Array.isArray(input.runtime.activeSceneRefs) || input.runtime.activeSceneRefs.length === 0 || input.runtime.activeSceneRefs.length > 32) fail('OPENING_RUNTIME_ACTIVE_SCENES_REQUIRED', 'runtime.activeSceneRefs must be non-empty.');
    const activeSeen = new Set();
    const activeSceneRefs = input.runtime.activeSceneRefs.map(function (raw) {
      const ref = targetRef(raw, 'Runtime active scene', sceneById, 'scene');
      if (activeSeen.has(ref.ref)) fail('OPENING_RUNTIME_SCENE_DUPLICATE', 'Runtime active scenes must be unique.', { ref: ref.ref });
      activeSeen.add(ref.ref);
      return ref;
    });
    const runtimeFile = {
      turn: 0,
      worldTime: typeof input.runtime.worldTime === 'string' ? input.runtime.worldTime.trim().slice(0, 120) : '',
      plotOrder: 1,
      location,
      weather: typeof input.runtime.weather === 'string' ? input.runtime.weather.trim().slice(0, 120) : '',
      activeSceneRefs,
      protagonistRef,
      extensions: isRecord(input.runtime.extensions) ? input.runtime.extensions : {},
      updatedAtTurn: 0,
      updatedBy: 'world-architect',
    };

    if (!isRecord(input.frontier) || !isRecord(input.frontier.sourceWindow)) fail('OPENING_FRONTIER_INVALID', 'frontier.sourceWindow must be an object.');
    const startIndex = integer(input.frontier.sourceWindow.startIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.startIndex', 1, source.chapters.length);
    const endIndex = integer(input.frontier.sourceWindow.endIndex, 'OPENING_WINDOW_INVALID', 'sourceWindow.endIndex', startIndex, source.chapters.length);
    if (endIndex - startIndex + 1 > 64) fail('OPENING_WINDOW_INVALID', 'sourceWindow may include at most 64 chapters.', { startIndex, endIndex });
    const sourceByIndex = new Map(source.chapters.map(function (chapter) { return [chapter.index, chapter]; }));
    const windowChapters = [];
    for (let chapterIndex = startIndex; chapterIndex <= endIndex; chapterIndex += 1) {
      const chapter = sourceByIndex.get(chapterIndex);
      if (!chapter) fail('OPENING_SOURCE_REF_UNKNOWN', 'Source window chapter is missing.', { chapter: chapterIndex });
      const compact = { index: chapter.index, title: chapter.title };
      if (isRecord(chapter.source)) compact.ref = sourceRefForChapter(chapter);
      else compact.path = sourceRefForChapter(chapter);
      windowChapters.push(compact);
    }
    if (!Array.isArray(input.frontier.timeline) || input.frontier.timeline.length === 0 || input.frontier.timeline.length > 32) fail('OPENING_TIMELINE_REQUIRED', 'frontier.timeline must be non-empty.');
    let previousChapter = startIndex;
    const timeline = input.frontier.timeline.map(function (raw, index) {
      if (!isRecord(raw)) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline anchor must be an object.', { index });
      const chapter = integer(raw.chapter, 'OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapter', startIndex, endIndex);
      if (chapter < previousChapter) fail('OPENING_TIMELINE_ANCHOR_INVALID', 'Timeline chapters must be non-decreasing.', { chapter, previousChapter });
      previousChapter = chapter;
      return { kind: 'source', order: index + 1, chapter, time: text(raw.time, 'OPENING_TIMELINE_TIME_REQUIRED', 'Timeline time', 120), label: text(raw.label, 'OPENING_TIMELINE_LABEL_REQUIRED', 'Timeline label', 120) };
    });
    const reason = typeof input.frontier.sourceWindow.reason === 'string' && input.frontier.sourceWindow.reason.trim() ? input.frontier.sourceWindow.reason.trim() : '开局已读来源窗口';
    const frontierFile = {
      sourceWindow: { start: startIndex, end: endIndex, chapters: windowChapters },
      extractedThrough: sourceRefForChapter(sourceByIndex.get(endIndex)),
      timeline,
      notes: typeof input.frontier.notes === 'string' && input.frontier.notes.trim() ? input.frontier.notes.trim() : reason,
      updatedBy: 'world-architect',
    };

    const summary = text(input.summary, 'OPENING_SETUP_SUMMARY_REQUIRED', 'summary', 2000);
    const openingReply = text(input.openingReply, 'OPENING_REPLY_REQUIRED', 'openingReply', 24000);
    const projected = await tsian.reply.project(openingReply);
    const projectionIssues = [];
    const projectionDetails = {
      displayContent: 'omitted',
      choiceCount: null,
    };
    const projectionDiagnostics = [];
    if (!isRecord(projected)) {
      projectionIssues.push({ code: 'projection.missing', path: 'projection' });
    } else {
      if (typeof projected.content !== 'string' || !projected.content.trim()) {
        projectionIssues.push({ code: 'content.empty', path: 'content' });
      }

      let visibleContent;
      if (projected.displayContent === undefined) {
        visibleContent = projected.content;
      } else if (typeof projected.displayContent !== 'string') {
        projectionDetails.displayContent = 'invalid';
        projectionIssues.push({ code: 'display.invalid', path: 'displayContent' });
      } else {
        projectionDetails.displayContent = 'present';
        visibleContent = projected.displayContent;
      }
      if (typeof visibleContent === 'string' && !visibleContent.trim()) {
        projectionIssues.push({ code: 'display.empty', path: 'displayContent' });
      }

      const choices = isRecord(projected.projections) ? projected.projections.choices : undefined;
      if (!Array.isArray(choices)) {
        projectionIssues.push({ code: 'choices.missing', path: 'projections.choices' });
      } else {
        projectionDetails.choiceCount = choices.length;
        if (choices.length < 1 || choices.length > 12) {
          projectionIssues.push({ code: 'choices.count', path: 'projections.choices' });
        }
        const invalidChoiceIndices = [];
        for (let index = 0; index < choices.length && index < 20; index += 1) {
          const choice = choices[index];
          if (typeof choice !== 'string' || !choice.trim() || choice.length > 300) invalidChoiceIndices.push(index);
        }
        if (invalidChoiceIndices.length > 0) {
          projectionIssues.push({ code: 'choices.item', path: 'projections.choices', indices: invalidChoiceIndices });
        }
      }

      if (typeof projected.configPresent === 'boolean') projectionDetails.configPresent = projected.configPresent;
      if (Number.isSafeInteger(projected.ruleCount) && projected.ruleCount >= 0) projectionDetails.ruleCount = projected.ruleCount;
      if (Number.isSafeInteger(projected.appliedRuleCount) && projected.appliedRuleCount >= 0) projectionDetails.appliedRuleCount = projected.appliedRuleCount;
      if (Array.isArray(projected.diagnostics)) {
        for (const diagnostic of projected.diagnostics.slice(0, 20)) {
          if (!isRecord(diagnostic) || typeof diagnostic.scope !== 'string' || typeof diagnostic.code !== 'string' || typeof diagnostic.message !== 'string') continue;
          const safeDiagnostic = {
            scope: diagnostic.scope.slice(0, 40),
            code: diagnostic.code.slice(0, 120),
            message: diagnostic.message.slice(0, 500),
          };
          if (typeof diagnostic.path === 'string') safeDiagnostic.path = diagnostic.path.slice(0, 500);
          if (typeof diagnostic.ruleId === 'string') safeDiagnostic.ruleId = diagnostic.ruleId.slice(0, 120);
          if (Number.isSafeInteger(diagnostic.ruleIndex) && diagnostic.ruleIndex >= 0) safeDiagnostic.ruleIndex = diagnostic.ruleIndex;
          projectionDiagnostics.push(safeDiagnostic);
        }
      }
    }
    if (projectionIssues.length > 0) {
      fail('OPENING_REPLY_PROJECTION_FAILED', 'openingReply projection is invalid; inspect details.issues.', {
        issues: projectionIssues,
        projection: projectionDetails,
        diagnostics: projectionDiagnostics,
      });
    }

    const cardManifest = await readJson(tsian, 'game-card.json');
    const entrypoints = isRecord(cardManifest.runtime) && isRecord(cardManifest.runtime.entrypoints) ? cardManifest.runtime.entrypoints : null;
    const playerTurnAgentId = safeAgentId(entrypoints && entrypoints.playerTurn);
    const playerTurnAgent = await readJson(tsian, 'agents/' + playerTurnAgentId + '/agent.json');
    if (!isRecord(playerTurnAgent) || playerTurnAgent.id !== playerTurnAgentId) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent config identity does not match its entrypoint.', { playerTurnAgentId });
    const playerTurnInstructions = await readText(tsian, 'agents/' + playerTurnAgentId + '/AGENT.md');
    if (!playerTurnInstructions.trim()) fail('OPENING_PLAYER_TURN_AGENT_INVALID', 'playerTurn agent instructions are empty.', { playerTurnAgentId });

    const turn0Path = 'save/history/turns/turn-000000.json';
    const playerContextPath = 'save/agents/' + playerTurnAgentId + '/context.json';
    const [existingRuntime, existingFrontier, existingUnderstanding, turnPaths, progressedTurnPaths, entityFiles, sceneFiles, relationshipFiles, entityUnexpected, sceneUnexpected, relationshipUnexpected, playerContexts, oldUnderstandingContext, oldPlaySetupContext, legacyNarrative, legacyProgress] = await Promise.all([
      optionalJson('save/playthrough/runtime.json'),
      optionalJson('save/playthrough/frontier.json'),
      optionalJson('save/playthrough/understanding-summary.json'),
      matches('save/history/turns/turn-*.json'),
      matches('save/history/turns/turn-*.json').then(function (paths) { return paths.filter(function (path) { return path !== turn0Path; }); }),
      matches('save/entities/*/*.json'),
      matches('save/scenes/*.json'),
      matches('save/relationships/*.json'),
      unexpectedFiles('save/entities'),
      unexpectedFiles('save/scenes'),
      unexpectedFiles('save/relationships'),
      matches('save/agents/' + playerTurnAgentId + '/context*.json'),
      optionalFile('save/agents/world-architect/context-understanding.json'),
      optionalFile('save/agents/world-architect/context-play-setup.json'),
      optionalFile('save/playthrough/opening-narrative.json'),
      optionalFile('save/playthrough/opening-progress.json'),
    ]);
    if ((isRecord(existingRuntime) && Number.isSafeInteger(existingRuntime.turn) && existingRuntime.turn > 0) || progressedTurnPaths.length > 0) {
      fail('OPENING_PLAY_ALREADY_STARTED', 'Formal play has already started.', { runtimeTurn: existingRuntime && existingRuntime.turn, progressedTurnPaths });
    }
    if (!isPendingSetup(setupSummary) || !isPendingRuntime(existingRuntime) || !isPendingFrontier(existingFrontier) || !isPendingUnderstanding(existingUnderstanding)
      || turnPaths.length || entityFiles.length || sceneFiles.length || relationshipFiles.length || entityUnexpected.length || sceneUnexpected.length
      || relationshipUnexpected.length || playerContexts.length || oldUnderstandingContext || oldPlaySetupContext || legacyNarrative || legacyProgress) {
      fail('OPENING_SAVE_NOT_CLEAN', 'This save contains legacy or formal opening state. Use a new save.');
    }

    const now = new Date().toISOString();
    frontierFile.updatedAt = now;
    const assistantItem = { kind: 'assistant', content: projected.content, projections: projected.projections };
    if (projected.displayContent !== undefined) assistantItem.displayContent = projected.displayContent;
    const turn0Record = { schema: 'tsian.airp.history.turn.v2', turn: 0, createdAt: now, source: { kind: 'agent-runtime', entryAgentId: playerTurnAgentId }, timeline: [assistantItem] };
    const playerContext = { schema: 'tsian.agent.context.v2', saveId: '', agentId: playerTurnAgentId, sequence: 1, summary: null, recentTurns: [{ sequence: 1, gameTurn: 0, role: 'assistant', content: projected.content }], lastCompressedSequence: null, updatedAt: now };
    const completedSummary = { status: 'complete', summary, committedAt: now, enteredPlay: false };
    const writtenPaths = [];
    async function writeJson(path, value) {
      const file = await tsian.workspace.write({ scope: 'save-runtime', path, content: JSON.stringify(value, null, 2) + '\n', mediaType: 'application/json' });
      writtenPaths.push(file.path);
    }
    for (const entity of entities) await writeJson(entity.path, entity.entity);
    for (const scene of scenes) await writeJson(scene.path, scene.scene);
    for (const relationship of relationships) await writeJson(relationship.path, relationship.file);
    await writeJson('save/playthrough/runtime.json', runtimeFile);
    await writeJson('save/playthrough/frontier.json', frontierFile);
    await writeJson(turn0Path, turn0Record);
    await writeJson(playerContextPath, playerContext);
    await writeJson('save/playthrough/setup-summary.json', completedSummary);
    tsian.trace('opening_committed', { sessionId: control.session.id, writes: writtenPaths });
    tsian.memory.set({ key: 'opening-commit:' + control.session.id, status: 'success', title: 'Opening committed', summary: 'Opening model, turn 0 and player context were committed.', anchors: writtenPaths, exact: { sessionId: control.session.id, sourceHash } });
    return { status: 'complete', writes: { entities: entities.length, scenes: scenes.length, relationships: relationships.length, turn0: turn0Path, playerContext: playerContextPath } };
  } catch (error) {
    tsian.trace('opening_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpening(input, tsian, signal);
