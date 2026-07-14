async function commitPlaySetup(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    // 1. 校验 protagonistRef 指向已存在 character entity
    const protagonistRef = normalizeString(input.protagonistRef, 'OPENING_PROTAGONIST_REF_REQUIRED', 'protagonistRef', 120);
    const parsedRef = normalizeEntityId(protagonistRef, 'protagonistRef');
    if (parsedRef.type !== 'character') fail('OPENING_PROTAGONIST_REF_INVALID', 'protagonistRef must use character:<localId>.', { ref: parsedRef.id });
    const entityPath = 'save/entities/character/' + parsedRef.localId + '.json';
    const entityFile = await tsian.workspace.read({ scope: 'effective', path: entityPath });
    if (!entityFile || typeof entityFile.content !== 'string') fail('OPENING_PROTAGONIST_ENTITY_MISSING', 'protagonistRef must point to an existing character entity.', { ref: parsedRef.id, path: entityPath });
    let protagonist = parseJson(entityFile.content, entityPath);
    if (!isRecord(protagonist)) fail('OPENING_PROTAGONIST_ENTITY_INVALID', 'Protagonist entity must be a JSON object.', { ref: parsedRef.id });
    // 2. 校验 summary 非空 ≤2000
    const summary = normalizeString(input.summary, 'OPENING_SETUP_SUMMARY_REQUIRED', 'summary', 2000);
    // 3. 校验 openingNarrative 非空
    const openingNarrative = normalizeString(input.openingNarrative, 'OPENING_NARRATIVE_REQUIRED', 'openingNarrative', 20000);
    // 4. 校验 traits[] 每项 id（trait:<localId>）+ name 必填，description/effects 可选
    const rawTraits = Array.isArray(input.traits) ? input.traits : [];
    const normalizedTraits = [];
    const traitIds = new Set();
    for (let i = 0; i < rawTraits.length; i++) {
      const raw = rawTraits[i];
      if (!isRecord(raw)) fail('PLAY_SETUP_TRAIT_INVALID', 'Each trait must be an object.', { index: i });
      const traitId = normalizeString(raw.id, 'PLAY_SETUP_TRAIT_ID_REQUIRED', 'trait id', 120);
      const traitName = normalizeString(raw.name, 'PLAY_SETUP_TRAIT_NAME_REQUIRED', 'trait name', 120);
      if (!traitId.startsWith('trait:')) fail('PLAY_SETUP_TRAIT_ID_INVALID', 'trait id must use trait:<localId>.', { id: traitId, index: i });
      if (traitIds.has(traitId)) fail('PLAY_SETUP_TRAIT_ID_DUPLICATE', 'Duplicate trait id in this commit.', { id: traitId, index: i });
      traitIds.add(traitId);
      const trait = { id: traitId, name: traitName };
      if (typeof raw.description === 'string' && raw.description.trim()) trait.description = raw.description.trim();
      if (Array.isArray(raw.effects)) {
        const effects = [];
        for (const e of raw.effects) { if (typeof e === 'string' && e.trim()) effects.push(e.trim()); }
        if (effects.length > 0) trait.effects = effects;
      }
      normalizedTraits.push(trait);
    }
    // 5. read-modify-write 主角 entity：合并 traits（按 id 去重覆盖，保留其他字段）
    const existingTraits = Array.isArray(protagonist.traits) ? protagonist.traits.filter((t) => isRecord(t) && typeof t.id === 'string') : [];
    const mergedById = new Map();
    for (const t of existingTraits) { mergedById.set(t.id, t); }
    for (const t of normalizedTraits) { mergedById.set(t.id, t); }
    const mergedTraits = Array.from(mergedById.values());
    const updatedEntity = { ...protagonist, traits: mergedTraits };
    const entityWrite = await tsian.workspace.write({ scope: 'save-runtime', path: entityPath, content: JSON.stringify(updatedEntity, null, 2) + '\n', mediaType: 'application/json' });
    // 6. 写 setup-summary.json = { status: 'complete', summary, committedAt, enteredPlay:false }
    const summaryFile = { status: 'complete', summary, committedAt: new Date().toISOString(), enteredPlay: false };
    const summaryWrite = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/setup-summary.json', content: JSON.stringify(summaryFile, null, 2) + '\n', mediaType: 'application/json' });
    // 7. 写 opening-narrative.json = { narrative, createdAt }
    const narrativeFile = { narrative: openingNarrative, createdAt: new Date().toISOString() };
    const narrativeWrite = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/opening-narrative.json', content: JSON.stringify(narrativeFile, null, 2) + '\n', mediaType: 'application/json' });
    const writes = [
      { path: entityWrite.path, size: entityWrite.content.length, kind: 'traits' },
      { path: summaryWrite.path, size: summaryWrite.content.length, kind: 'setup-summary' },
      { path: narrativeWrite.path, size: narrativeWrite.content.length, kind: 'opening-narrative' },
    ];
    tsian.trace('play_setup_committed', { protagonistRef: parsedRef.id, traitCount: normalizedTraits.length, writes: writes.map((w) => w.path) });
    // 8. 返回 { status: 'ready', writes }，不含 narrative 正文，避免 Step 4 UI 提前展示
    return { status: 'ready', writes };
  } catch (error) {
    tsian.trace('play_setup_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitPlaySetup(input, tsian, signal);
