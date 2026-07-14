function normalizeString(value, code, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) fail(code, label + ' must be a non-empty string.');
  const normalized = value.trim();
  if (maxLength && normalized.length > maxLength) fail(code + '_TOO_LONG', label + ' is too long.', { maxLength, length: normalized.length });
  return normalized;
}
function normalizeSegment(value, label) {
  const segment = normalizeString(value, 'OPENING_ENTITY_ID_INVALID', label, 80);
  if (segment === '.' || segment === '..' || /[\/:\0]/.test(segment)) fail('OPENING_ENTITY_ID_INVALID', label + ' must not contain path separators, colon, NUL, . or ...', { value });
  return segment;
}
function normalizeEntityId(rawId, label) {
  const id = normalizeString(rawId, 'OPENING_ENTITY_ID_REQUIRED', label, 120);
  const parts = id.split(':');
  if (parts.length !== 2) fail('OPENING_ENTITY_ID_INVALID', label + ' must use <type>:<localId>.', { id });
  const type = normalizeSegment(parts[0], 'Entity type');
  const localId = normalizeSegment(parts[1], 'Entity localId');
  return { id: type + ':' + localId, type, localId };
}
function normalizeEntity(rawEntity, index) {
  if (!isRecord(rawEntity)) fail('OPENING_ENTITY_INVALID', 'Each entity must be an object.', { index });
  const parsed = normalizeEntityId(rawEntity.id, 'Entity id');
  const entity = { ...rawEntity, id: parsed.id, name: normalizeString(rawEntity.name, 'OPENING_ENTITY_NAME_REQUIRED', 'Entity name', 120), brief: normalizeString(rawEntity.brief, 'OPENING_ENTITY_BRIEF_REQUIRED', 'Entity brief', 1000) };
  if (parsed.type === 'container') { if (entity.type !== 'container') fail('OPENING_ENTITY_TYPE_INVALID', 'container entity must have type="container".', { id: parsed.id, type: entity.type }); }
  else if (parsed.type === 'item') { const t = typeof entity.type === 'string' ? entity.type.trim() : ''; if (!['equipment', 'material', 'consumable', 'special', 'other'].includes(t)) fail('OPENING_ENTITY_TYPE_INVALID', 'item entity type must be one of equipment/material/consumable/special/other.', { id: parsed.id, type: entity.type }); entity.type = t; }
  return { path: 'save/entities/' + parsed.type + '/' + parsed.localId + '.json', entity };
}
function normalizeRef(rawRef, label, knownEntityIds, context) {
  if (!isRecord(rawRef)) fail('OPENING_REF_INVALID', label + ' must be an object { ref, name }.', context);
  const parsed = normalizeEntityId(rawRef.ref, label + ' ref');
  if (knownEntityIds && !knownEntityIds.has(parsed.id)) fail('OPENING_REF_UNKNOWN', label + ' ref must point to an entity in this commit or an existing entity.', { ...context, ref: parsed.id });
  return { ref: parsed.id, name: normalizeString(rawRef.name, 'OPENING_REF_NAME_REQUIRED', label + ' name', 120) };
}
function normalizeScene(rawScene, knownEntityIds) {
  if (!isRecord(rawScene)) fail('OPENING_SCENE_INVALID', 'Opening scene must be an object.');
  const parsed = normalizeEntityId(rawScene.id, 'Scene id');
  if (parsed.type !== 'scene') fail('OPENING_SCENE_TYPE_INVALID', 'Scene id must use scene:<localId>.', { id: parsed.id });
  const name = normalizeString(rawScene.name, 'OPENING_SCENE_NAME_REQUIRED', 'Scene name', 120);
  const location = normalizeRef(rawScene.location, 'Scene location', knownEntityIds, { scene: parsed.id });
  const presentRaw = Array.isArray(rawScene.present) ? rawScene.present : [];
  if (presentRaw.length === 0) fail('OPENING_SCENE_PRESENT_REQUIRED', 'Scene present must list at least one entity.', { scene: parsed.id });
  const present = presentRaw.map((item, index) => {
    if (!isRecord(item)) fail('OPENING_SCENE_PRESENT_INVALID', 'Scene present entry must be an object { ref }.', { scene: parsed.id, index });
    const refParsed = normalizeEntityId(item.ref, 'Scene present[' + index + '] ref');
    if (knownEntityIds && !knownEntityIds.has(refParsed.id)) fail('OPENING_REF_UNKNOWN', 'Scene present ref must point to an entity in this commit or an existing entity.', { scene: parsed.id, index, ref: refParsed.id });
    return { ref: refParsed.id };
  });
  return { id: parsed.id, name, location, present };
}
function scopeFromSubject(subjectId) {
  const parsed = normalizeEntityId(subjectId, 'Relationship subject');
  return parsed.type + '-' + parsed.localId;
}
function normalizeRelationships(rawRelationships, knownEntityIds) {
  if (!Array.isArray(rawRelationships)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of rawRelationships) {
    if (!isRecord(raw)) fail('OPENING_RELATIONSHIP_INVALID', 'Each relationship must be an object { subject, edges }.');
    const subjectParsed = normalizeEntityId(raw.subject, 'Relationship subject');
    if (subjectParsed.type !== 'character') fail('OPENING_RELATIONSHIP_SUBJECT_TYPE_INVALID', 'Relationship subject must use character:<localId>; relationships are character/person social edges, not a generic entity graph.', { subject: subjectParsed.id, type: subjectParsed.type });
    if (knownEntityIds && !knownEntityIds.has(subjectParsed.id)) fail('OPENING_RELATIONSHIP_SUBJECT_UNKNOWN', 'Relationship subject must point to an entity in this commit or an existing entity.', { subject: subjectParsed.id });
    const scope = scopeFromSubject(raw.subject);
    if (seen.has(scope)) fail('OPENING_RELATIONSHIP_DUPLICATE_SUBJECT', 'Duplicate relationship subject in this commit.', { subject: subjectParsed.id });
    seen.add(scope);
    const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
    if (edgesRaw.length === 0) fail('OPENING_RELATIONSHIP_EDGES_REQUIRED', 'Relationship must have at least one edge.', { subject: subjectParsed.id });
    const edges = edgesRaw.map((edge, index) => {
      if (!isRecord(edge)) fail('OPENING_RELATIONSHIP_EDGE_INVALID', 'Each edge must be an object.', { subject: subjectParsed.id, index });
      const toParsed = normalizeEntityId(edge.to, 'Edge to');
      if (toParsed.type !== 'character') fail('OPENING_RELATIONSHIP_TO_TYPE_INVALID', 'Relationship edge.to must use character:<localId>; put non-character associations in fixed fields, existing ref structures, or extensions.render="ref".', { subject: subjectParsed.id, to: toParsed.id, type: toParsed.type });
      if (knownEntityIds && !knownEntityIds.has(toParsed.id)) fail('OPENING_RELATIONSHIP_TO_UNKNOWN', 'Edge to must point to an entity in this commit or an existing entity.', { subject: subjectParsed.id, to: toParsed.id });
      return { to: toParsed.id, type: normalizeString(edge.type, 'OPENING_RELATIONSHIP_TYPE_REQUIRED', 'Edge type', 60), since: typeof edge.since === 'number' ? edge.since : 0, until: typeof edge.until === 'number' ? edge.until : undefined, note: typeof edge.note === 'string' && edge.note.trim() ? edge.note.trim() : undefined };
    });
    result.push({ subject: subjectParsed.id, edges, scope });
  }
  return result;
}
function normalizeCandidate(rawCandidate, index) {
  if (!isRecord(rawCandidate)) fail('OPENING_CANDIDATE_INVALID', 'Each candidate character must be an object.', { index });
  const parsed = normalizeEntityId(rawCandidate.id, 'Candidate id');
  if (parsed.type !== 'character') fail('OPENING_CANDIDATE_TYPE_INVALID', 'Candidate id must use character:<localId>.', { id: parsed.id, type: parsed.type });
  var candidate = { id: parsed.id, name: normalizeString(rawCandidate.name, 'OPENING_CANDIDATE_NAME_REQUIRED', 'Candidate name', 120), brief: normalizeString(rawCandidate.brief, 'OPENING_CANDIDATE_BRIEF_REQUIRED', 'Candidate brief', 500) };
  if (typeof rawCandidate.gender === 'string' && rawCandidate.gender.trim()) candidate.gender = rawCandidate.gender.trim();
  return candidate;
}
function normalizeWindow(rawWindow, knownPaths) {
  if (!isRecord(rawWindow)) fail('OPENING_WINDOW_INVALID', 'Window must be an object.');
  const startIndex = normalizePositiveInt(rawWindow.startIndex, 1, 1, 999999);
  const endIndex = normalizePositiveInt(rawWindow.endIndex, startIndex, startIndex, 999999);
  const reason = normalizeString(rawWindow.reason, 'OPENING_WINDOW_REASON_REQUIRED', 'Window reason', 1000);
  const chapters = Array.isArray(rawWindow.chapters) ? rawWindow.chapters : [];
  const normalizedChapters = chapters.map((chapter, index) => {
    if (!isRecord(chapter)) fail('OPENING_WINDOW_CHAPTER_INVALID', 'Window chapters must be objects.', { index });
    const path = normalizeString(chapter.path, 'OPENING_WINDOW_CHAPTER_PATH_REQUIRED', 'Window chapter path', 240);
    if (!knownPaths.has(path)) fail('OPENING_SOURCE_REF_UNKNOWN', 'Window chapter path is not in imported chapter index.', { path });
    return { index: normalizePositiveInt(chapter.index, index + 1, 1, 999999), title: typeof chapter.title === 'string' ? chapter.title.trim() : '', path };
  });
  return { startIndex, endIndex, reason, chapters: normalizedChapters };
}
async function loadExistingEntityIds(tsian) {
  const result = await tsian.workspace.glob({ scope: 'effective', pattern: 'save/entities/*/*.json', limit: 10000 });
  const globResult = result || {};
  const matches = Array.isArray(globResult.matches) ? globResult.matches : [];
  if (globResult.truncated) fail('OPENING_ENTITY_GLOB_TRUNCATED', 'Entity count exceeds workspace.glob limit; resolve existing refs explicitly or narrow the pattern.', { limit: matches.length });
  return new Set(matches.map((p) => { const seg = p.slice('save/entities/'.length).replace(/\.json$/, '').split('/'); return seg[0] + ':' + seg[1]; }));
}
