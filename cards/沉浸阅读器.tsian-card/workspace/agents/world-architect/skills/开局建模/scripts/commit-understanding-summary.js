async function commitUnderstandingSummary(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    const title = normalizeString(input.title, 'OPENING_SUMMARY_TITLE_REQUIRED', 'Summary title', 120);
    const candidatesRaw = Array.isArray(input.candidateCharacters) ? input.candidateCharacters : null;
    if (candidatesRaw === null) fail('OPENING_CANDIDATES_REQUIRED', 'candidateCharacters field is required (may be empty array).');
    const candidateCharacters = candidatesRaw.map(normalizeCandidate);
    const summaryFile = { status: 'ready', title, candidateCharacters };
    const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/understanding-summary.json', content: JSON.stringify(summaryFile, null, 2) + '\n', mediaType: 'application/json' });
    tsian.trace('opening_understanding_summary_committed', { title, candidateCount: candidateCharacters.length, write: file.path });
    return { status: 'ready', write: { path: file.path, size: file.content.length } };
  } catch (error) {
    tsian.trace('opening_understanding_summary_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitUnderstandingSummary(input, tsian, signal);
