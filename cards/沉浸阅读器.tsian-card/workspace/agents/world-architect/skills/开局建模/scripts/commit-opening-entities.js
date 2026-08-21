async function commitOpeningEntities(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    const authority = await openingMutableAuthority(tsian);
    if (authority.alreadyComplete) return { status: 'complete', alreadyComplete: true, phase: 'entities', writes: [] };
    if (!isRecord(input) || !Array.isArray(input.entities) || input.entities.length === 0 || input.entities.length > 64) {
      fail('OPENING_ENTITIES_REQUIRED', 'entities must be a bounded non-empty array.');
    }
    const proposed = [];
    const proposedByPath = new Map();
    const ids = new Set();
    for (let index = 0; index < input.entities.length; index += 1) {
      const raw = input.entities[index];
      if (!isRecord(raw)) fail('OPENING_ENTITY_INVALID', 'Each entity must be an object.', { index: index });
      const parsed = normalizeEntityId(raw.id, 'Entity id');
      const name = normalizeString(raw.name, 'OPENING_ENTITY_NAME_REQUIRED', 'Entity name', 120);
      const brief = normalizeString(raw.brief, 'OPENING_ENTITY_BRIEF_REQUIRED', 'Entity brief', 2000);
      const path = 'save/entities/' + parsed.type + '/' + parsed.localId + '.json';
      if (ids.has(parsed.id) || proposedByPath.has(path)) fail('OPENING_ENTITY_DUPLICATE', 'Duplicate entity id/path.', { id: parsed.id, path: path });
      const entity = { ...raw, id: parsed.id, name: name, brief: brief };
      if (parsed.type === 'container') {
        if (entity.contents !== undefined && !Array.isArray(entity.contents)) fail('OPENING_CONTAINER_CONTENTS_INVALID', 'Container contents must be an array when present.', { id: parsed.id });
        entity.type = 'container';
        if (entity.contents === undefined) entity.contents = [];
      }
      if (parsed.type === 'item') {
        if (entity.type !== undefined && (typeof entity.type !== 'string' || !entity.type.trim())) fail('OPENING_ITEM_TYPE_INVALID', 'Item type must be a non-empty string when present.', { id: parsed.id });
        if (entity.type === undefined) entity.type = 'other';
      }
      ids.add(parsed.id);
      proposedByPath.set(path, entity);
      proposed.push({ path: path, value: entity });
    }

    const existingPaths = await openingGlob(tsian, 'save/entities/*/*.json', 'OPENING_ENTITY_GLOB_TRUNCATED');
    openingAssertPathSet(existingPaths, new Set(proposedByPath.keys()), 'OPENING_ENTITIES_CONFLICT', 'Entity authority');
    if (await openingLockedPhaseIsIdentical(tsian, proposedByPath, existingPaths)) {
      return { status: 'ready', alreadyComplete: true, phase: 'entities', writes: [] };
    }
    const [scenePaths, relationshipPaths, frontier] = await Promise.all([
      openingGlob(tsian, 'save/scenes/*.json', 'OPENING_SCENE_GLOB_TRUNCATED'),
      openingGlob(tsian, 'save/relationships/*.json', 'OPENING_RELATIONSHIP_GLOB_TRUNCATED'),
      openingOptionalJson(tsian, OPENING_FRONTIER_PATH),
    ]);
    const downstreamExists = scenePaths.length > 0 || relationshipPaths.length > 0 || openingStateHasModel(authority.status.runtime, frontier);
    if (downstreamExists) {
      fail('OPENING_ENTITIES_LOCKED', 'Entity paths are locked after a downstream opening phase has completed.');
    }

    const writes = [];
    for (const item of proposed) {
      signal.throwIfAborted();
      const file = await openingWriteJson(tsian, item.path, item.value);
      writes.push(file.path);
    }
    tsian.trace('opening_entities_committed', { sessionId: authority.control.session.id, count: writes.length, writes: writes });
    return { status: 'ready', phase: 'entities', writes: writes };
  } catch (error) {
    tsian.trace('opening_entities_commit_failed', { code: error && error.code || 'OPENING_ENTITIES_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpeningEntities(input, tsian, signal);
