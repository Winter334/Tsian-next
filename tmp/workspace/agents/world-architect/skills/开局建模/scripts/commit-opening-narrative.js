async function commitOpeningNarrative(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    const narrative = typeof input.narrative === 'string' ? input.narrative.trim() : '';
    if (!narrative) fail('OPENING_NARRATIVE_REQUIRED', 'narrative must be a non-empty string.');
    const narrativeFile = { narrative, createdAt: new Date().toISOString() };
    const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/opening-narrative.json', content: JSON.stringify(narrativeFile, null, 2) + '\n', mediaType: 'application/json' });
    tsian.trace('opening_narrative_committed', { size: file.content.length, write: file.path });
    return { status: 'ready', write: { path: file.path, size: file.content.length } };
  } catch (error) {
    tsian.trace('opening_narrative_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitOpeningNarrative(input, tsian, signal);
