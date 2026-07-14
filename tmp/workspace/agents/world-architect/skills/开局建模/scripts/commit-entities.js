async function commitEntities(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    if (!Array.isArray(input.entities) || input.entities.length === 0) fail('OPENING_ENTITIES_REQUIRED', 'At least one opening entity is required.');
    const entities = input.entities.map(normalizeEntity);
    const writes = [];
    for (const item of entities) {
      signal.throwIfAborted();
      const file = await tsian.workspace.write({ scope: 'save-runtime', path: item.path, content: JSON.stringify(item.entity, null, 2) + '\n', mediaType: 'application/json' });
      writes.push({ path: file.path, size: file.content.length });
    }
    const entityIds = entities.map((item) => item.entity.id);
    tsian.trace('opening_entities_committed', { entityCount: entities.length, writes: writes.map((w) => w.path) });
    return { status: 'ready', writes, entityCount: entities.length, entityIds };
  } catch (error) {
    tsian.trace('opening_entities_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitEntities(input, tsian, signal);
