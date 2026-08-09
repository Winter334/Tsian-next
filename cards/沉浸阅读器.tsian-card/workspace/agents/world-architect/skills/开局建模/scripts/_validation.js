function normalizeString(value, code, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) fail(code, label + ' must be a non-empty string.');
  const normalized = value.trim();
  if (maxLength && normalized.length > maxLength) fail(code + '_TOO_LONG', label + ' is too long.', { maxLength, length: normalized.length });
  return normalized;
}
function normalizeSegment(value, label) {
  const segment = normalizeString(value, 'OPENING_ENTITY_ID_INVALID', label, 80);
  if (segment === '.' || segment === '..' || /[\\/:\x00-\x1f\x7f]/.test(segment)) fail('OPENING_ENTITY_ID_INVALID', label + ' must be one safe path segment.', { value });
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
