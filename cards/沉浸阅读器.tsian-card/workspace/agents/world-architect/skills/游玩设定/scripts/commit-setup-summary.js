async function commitSetupSummary(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    if (!isRecord(input)) fail('OPENING_COMMIT_INVALID', 'Commit input must be an object.');
    const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
    if (!summary) fail('OPENING_SETUP_SUMMARY_REQUIRED', 'summary must be a non-empty string.');
    if (summary.length > 2000) fail('OPENING_SETUP_SUMMARY_TOO_LONG', 'summary is too long.', { maxLength: 2000, length: summary.length });
    const summaryFile = { status: 'complete', summary, committedAt: new Date().toISOString(), enteredPlay: false };
    const file = await tsian.workspace.write({ scope: 'save-runtime', path: 'save/playthrough/setup-summary.json', content: JSON.stringify(summaryFile, null, 2) + '\n', mediaType: 'application/json' });
    tsian.trace('setup_summary_committed', { size: file.content.length, write: file.path });
    return { status: 'ready', write: { path: file.path, size: file.content.length } };
  } catch (error) {
    tsian.trace('setup_summary_commit_failed', { code: error && error.code || 'OPENING_COMMIT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return commitSetupSummary(input, tsian, signal);
