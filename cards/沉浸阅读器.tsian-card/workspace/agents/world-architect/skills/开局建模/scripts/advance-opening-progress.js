async function advanceOpeningProgress(input, tsian, signal) {
  signal.throwIfAborted();
  if (!isRecord(input) || !isRecord(input.session)) fail('OPENING_PROGRESS_INVALID', 'Input must contain session and next objects.');
  const control = normalizeOpeningControl(await readJson(tsian, OPENING_CONTROL_PATH));
  const session = input.session;
  const sessionId = progressText(session.sessionId, 'session.sessionId', 80);
  const sourceHash = progressText(session.sourceHash, 'session.sourceHash', 32);
  const branch = session.branch;
  const basedOnRevision = progressInt(session.basedOnRevision, 'session.basedOnRevision', 0);
  const attemptId = progressText(session.attemptId, 'session.attemptId', 100);
  if (sessionId !== control.sessionId || sourceHash !== control.sourceHash || branch !== control.branch) fail('OPENING_SESSION_MISMATCH', 'Session/source/branch does not match opening control.');
  const existingRaw = await readOptionalJson(tsian, OPENING_PROGRESS_PATH);
  const existing = existingRaw ? normalizeStoredOpeningProgress(existingRaw, control) : null;
  const previous = existing || emptyOpeningProgress(control);
  const next = normalizeProgressSnapshot(input.next, control, basedOnRevision + 1, attemptId);
  assertProgressSourceRefs(next, await loadSource(tsian));
  if (previous.revision === basedOnRevision + 1 && previous.processedAttemptId === attemptId) {
    if (semanticProgress(previous) !== semanticProgress(next)) fail('OPENING_PROGRESS_ATTEMPT_CONFLICT', 'The same attempt was already applied with different progress.');
    return { status: 'unchanged', progress: previous };
  }
  if (control.revision !== basedOnRevision || previous.revision !== basedOnRevision) fail('OPENING_PROGRESS_CONFLICT', 'Opening progress revision changed; read it again before advancing.', { controlRevision: control.revision, progressRevision: previous.revision, basedOnRevision });
  const expectedAttempt = basedOnRevision === 0 ? 'start' : control.value.attempt && control.value.attempt.id;
  if (expectedAttempt !== attemptId || (control.value.attempt && control.value.attempt.status !== 'submitted')) fail('OPENING_PROGRESS_ATTEMPT_CONFLICT', 'attemptId is not the current submitted opening attempt.', { expectedAttempt, attemptId });
  assertProgressInheritance(previous, next);
  const nextControl = { ...control.value, session: { ...control.value.session, revision: next.revision } };
  delete nextControl.attempt;
  await tsian.workspace.write({ scope: 'save-runtime', path: OPENING_PROGRESS_PATH, content: JSON.stringify(next, null, 2) + '\n' });
  await tsian.workspace.write({ scope: 'save-runtime', path: OPENING_CONTROL_PATH, content: JSON.stringify(nextControl, null, 2) + '\n' });
  tsian.memory.set({ key: 'opening-progress:' + control.sessionId, status: 'success', title: 'Opening progress advanced', summary: 'Authoritative opening progress and control revision were advanced atomically.', anchors: [OPENING_CONTROL_PATH, OPENING_PROGRESS_PATH], exact: { sessionId: control.sessionId, sourceHash: control.sourceHash, revision: next.revision, phase: next.phase, attemptId } });
  return { status: 'advanced', progress: next };
}
return advanceOpeningProgress(input, tsian, signal);
