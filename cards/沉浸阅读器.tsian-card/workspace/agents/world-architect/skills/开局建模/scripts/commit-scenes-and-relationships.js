async function commitScenesAndRelationships(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) fail('OPENING_SCENES_REQUIRED', 'At least one opening scene is required.');
    if (!Array.isArray(input.relationships)) fail('OPENING_RELATIONSHIPS_REQUIRED', 'relationships must be an array.');
    const knownEntityIds = await loadExistingEntityIds(tsian);
    const committedAt = new Date().toISOString();
    // 先全部校验，再统一写入，避免 scenes 已落盘而 relationships 校验失败造成半成品
    const normalizedScenes = input.scenes.map((rawScene) => normalizeScene(rawScene, knownEntityIds));
    const relationships = normalizeRelationships(input.relationships, knownEntityIds);
    const writes = [];
    const sceneIds = [];
    for (const scene of normalizedScenes) {
      signal.throwIfAborted();
      const sceneLocalId = scene.id.split(':')[1];
      const sceneFile = { id: scene.id, name: scene.name, location: scene.location, present: scene.present, status: 'active', updatedTurn: 0, updatedBy: 'world-architect', updatedAt: committedAt };
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/scenes/' + sceneLocalId + '.json', content: JSON.stringify(sceneFile, null, 2) + '\n', mediaType: 'application/json' });
      writes.push({ path: file.path, size: file.content.length });
      sceneIds.push(scene.id);
    }
    for (const rel of relationships) {
      signal.throwIfAborted();
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/relationships/' + rel.scope + '.json', content: JSON.stringify({ subject: rel.subject, edges: rel.edges, updatedTurn: 0, updatedBy: 'world-architect' }, null, 2) + '\n', mediaType: 'application/json' });
      writes.push({ path: file.path, size: file.content.length });
    }
    tsian.trace('opening_scenes_and_relationships_committed', { sceneCount: sceneIds.length, relationshipCount: relationships.length, writes: writes.map((w) => w.path) });
    return { status: 'ready', writes, sceneCount: sceneIds.length, sceneIds, relationshipCount: relationships.length };
  } catch (error) {
    tsian.trace('opening_scenes_and_relationships_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitScenesAndRelationships(input, tsian, signal);
