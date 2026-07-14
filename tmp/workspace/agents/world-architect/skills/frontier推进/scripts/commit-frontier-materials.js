async function commitFrontierMaterials(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('FRONTIER_MATERIALS_INVALID', 'Commit input must be an object.');
    const writes = [];
    // 1. entities（可选，可为空数组）
    const entitiesRaw = Array.isArray(input.entities) ? input.entities : [];
    const entities = entitiesRaw.map(normalizeEntity);
    // 2. relationships（可选，可为空数组）
    const relationshipsRaw = Array.isArray(input.relationships) ? input.relationships : [];
    const knownEntityIds = await loadExistingEntityIds(tsian);
    for (const item of entities) { knownEntityIds.add(item.entity.id); }
    const relationships = normalizeRelationships(relationshipsRaw, knownEntityIds);
    // 3. schemaPatches（可选，可为空数组）— 写入 save/schema/patches/pending/ 下
    const schemaPatchesRaw = Array.isArray(input.schemaPatches) ? input.schemaPatches : [];
    // 全部校验通过，统一写入
    for (const item of entities) {
      signal.throwIfAborted();
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: item.path, content: JSON.stringify(item.entity, null, 2) + '\n', mediaType: 'application/json' });
      writes.push({ path: file.path, size: file.content.length, kind: 'entity' });
    }
    for (const rel of relationships) {
      signal.throwIfAborted();
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/relationships/' + rel.scope + '.json', content: JSON.stringify({ subject: rel.subject, edges: rel.edges, updatedTurn: 0, updatedBy: 'world-architect' }, null, 2) + '\n', mediaType: 'application/json' });
      writes.push({ path: file.path, size: file.content.length, kind: 'relationship' });
    }
    for (let i = 0; i < schemaPatchesRaw.length; i++) {
      signal.throwIfAborted();
      const patch = schemaPatchesRaw[i];
      if (!isRecord(patch) || typeof patch.content !== 'string' || !patch.content.trim()) fail('FRONTIER_SCHEMA_PATCH_INVALID', 'Each schemaPatch must be an object with non-empty content string.', { index: i });
      const patchName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-') : 'patch-' + (i + 1);
      const patchPath = 'save/schema/patches/pending/' + patchName + '.md';
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: patchPath, content: patch.content, mediaType: 'text/markdown' });
      writes.push({ path: file.path, size: file.content.length, kind: 'schema-patch' });
    }
    tsian.trace('frontier_materials_committed', { entityCount: entities.length, relationshipCount: relationships.length, schemaPatchCount: schemaPatchesRaw.length, writes: writes.map((w) => w.path) });
    return { status: 'ready', writes, entityCount: entities.length, relationshipCount: relationships.length, schemaPatchCount: schemaPatchesRaw.length };
  } catch (error) {
    tsian.trace('frontier_materials_commit_failed', { code: error && error.code || 'FRONTIER_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitFrontierMaterials(input, tsian, signal);
