async function commitOpeningGraph(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    const authority = await openingMutableAuthority(tsian);
    if (authority.alreadyComplete) return { status: 'complete', alreadyComplete: true, phase: 'graph', writes: [] };
    if (!isRecord(input) || !Array.isArray(input.scenes) || input.scenes.length === 0 || input.scenes.length > 32) {
      fail('OPENING_SCENES_REQUIRED', 'scenes must be a bounded non-empty array.');
    }
    if (!Array.isArray(input.relationships) || input.relationships.length > 64) {
      fail('OPENING_RELATIONSHIPS_INVALID', 'relationships must be a bounded array.');
    }
    const entities = await openingLoadEntities(tsian);
    if (entities.byId.size === 0) fail('OPENING_ENTITIES_REQUIRED', 'Graph phase requires committed entity authority.');
    const proposed = [];
    const proposedByPath = new Map();
    const sceneIds = new Set();
    for (let index = 0; index < input.scenes.length; index += 1) {
      const raw = input.scenes[index];
      if (!isRecord(raw)) fail('OPENING_SCENE_INVALID', 'Each scene must be an object.', { index: index });
      const parsed = normalizeEntityId(raw.id, 'Scene id');
      if (parsed.type !== 'scene') fail('OPENING_SCENE_TYPE_INVALID', 'Scene id must use scene:<localId>.', { id: parsed.id });
      const name = normalizeString(raw.name, 'OPENING_SCENE_NAME_REQUIRED', 'Scene name', 120);
      const location = openingAuthorityRef(raw.location, 'Scene location', entities.byId, 'location');
      if (!Array.isArray(raw.present) || raw.present.length === 0 || raw.present.length > 64) {
        fail('OPENING_SCENE_PRESENT_REQUIRED', 'Scene present must be a bounded non-empty array.', { id: parsed.id });
      }
      const presentIds = new Set();
      const present = raw.present.map(function (entry, presentIndex) {
        if (!isRecord(entry)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present entries must contain ref.', { scene: parsed.id, index: presentIndex });
        const target = openingAuthorityRef(entry, 'Scene present', entities.byId);
        if (presentIds.has(target.ref)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present refs must be unique.', { scene: parsed.id, ref: target.ref });
        presentIds.add(target.ref);
        return { ref: target.ref };
      });
      const path = 'save/scenes/' + parsed.localId + '.json';
      if (sceneIds.has(parsed.id) || proposedByPath.has(path)) fail('OPENING_SCENE_DUPLICATE', 'Duplicate scene id/path.', { id: parsed.id, path: path });
      const scene = { ...raw, id: parsed.id, name: name, location: location, present: present };
      if (typeof scene.status !== 'string' || !scene.status.trim()) scene.status = 'active';
      if (!isRecord(scene.extensions)) scene.extensions = {};
      sceneIds.add(parsed.id);
      proposedByPath.set(path, scene);
      proposed.push({ path: path, value: scene });
    }

    const relationshipSubjects = new Set();
    for (let index = 0; index < input.relationships.length; index += 1) {
      const raw = input.relationships[index];
      if (!isRecord(raw)) fail('OPENING_RELATIONSHIP_INVALID', 'Each relationship must be an object.', { index: index });
      const subject = normalizeEntityId(raw.subject, 'Relationship subject');
      if (subject.type !== 'character' || !entities.byId.has(subject.id)) {
        fail('OPENING_RELATIONSHIP_SUBJECT_UNKNOWN', 'Relationship subject must point to a committed character.', { subject: subject.id });
      }
      if (relationshipSubjects.has(subject.id)) fail('OPENING_RELATIONSHIP_DUPLICATE_SUBJECT', 'Relationship subjects must be unique.', { subject: subject.id });
      if (!Array.isArray(raw.edges) || raw.edges.length === 0 || raw.edges.length > 64) {
        fail('OPENING_RELATIONSHIP_EDGES_REQUIRED', 'Relationship edges must be a bounded non-empty array.', { subject: subject.id });
      }
      const edges = raw.edges.map(function (edge, edgeIndex) {
        if (!isRecord(edge)) fail('OPENING_RELATIONSHIP_EDGE_INVALID', 'Relationship edge must be an object.', { subject: subject.id, index: edgeIndex });
        const to = normalizeEntityId(edge.to, 'Relationship target');
        if (to.type !== 'character' || !entities.byId.has(to.id)) {
          fail('OPENING_RELATIONSHIP_TO_UNKNOWN', 'Relationship target must point to a committed character.', { subject: subject.id, to: to.id });
        }
        const normalized = { ...edge, to: to.id, type: normalizeString(edge.type, 'OPENING_RELATIONSHIP_TYPE_REQUIRED', 'Relationship type', 80) };
        if (!Number.isSafeInteger(normalized.since)) normalized.since = 0;
        return normalized;
      });
      const path = 'save/relationships/character-' + subject.localId + '.json';
      const relationship = { ...raw, subject: subject.id, edges: edges };
      relationshipSubjects.add(subject.id);
      proposedByPath.set(path, relationship);
      proposed.push({ path: path, value: relationship });
    }

    const existingScenePaths = await openingGlob(tsian, 'save/scenes/*.json', 'OPENING_SCENE_GLOB_TRUNCATED');
    const existingRelationshipPaths = await openingGlob(tsian, 'save/relationships/*.json', 'OPENING_RELATIONSHIP_GLOB_TRUNCATED');
    const targetPaths = new Set(proposedByPath.keys());
    openingAssertPathSet(existingScenePaths.concat(existingRelationshipPaths), targetPaths, 'OPENING_GRAPH_CONFLICT', 'Scene/relationship authority');
    if (await openingLockedPhaseIsIdentical(tsian, proposedByPath, existingScenePaths.concat(existingRelationshipPaths))) {
      return { status: 'ready', alreadyComplete: true, phase: 'graph', writes: [] };
    }
    const frontier = await openingOptionalJson(tsian, OPENING_FRONTIER_PATH);
    if (openingStateHasModel(authority.status.runtime, frontier)) {
      fail('OPENING_GRAPH_LOCKED', 'Scene and relationship paths are locked after opening state has completed.');
    }

    const writes = [];
    for (const item of proposed) {
      signal.throwIfAborted();
      const file = await openingWriteJson(tsian, item.path, item.value);
      writes.push(file.path);
    }
    tsian.trace('opening_graph_committed', { sessionId: authority.control.session.id, scenes: input.scenes.length, relationships: input.relationships.length, writes: writes });
    return { status: 'ready', phase: 'graph', writes: writes };
  } catch (error) {
    tsian.trace('opening_graph_commit_failed', { code: error && error.code || 'OPENING_GRAPH_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpeningGraph(input, tsian, signal);
