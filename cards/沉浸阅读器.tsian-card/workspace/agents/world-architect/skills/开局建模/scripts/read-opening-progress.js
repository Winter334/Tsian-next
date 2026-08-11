async function readOpeningProgress(input, tsian, signal) {
  signal.throwIfAborted();
  const control = normalizeOpeningControl(await readJson(tsian, OPENING_CONTROL_PATH));
  const progress = await readOptionalJson(tsian, OPENING_PROGRESS_PATH);
  const normalized = progress ? normalizeStoredOpeningProgress(progress, control) : emptyOpeningProgress(control);
  assertProgressSourceRefs(normalized, await loadSource(tsian));
  tsian.memory.set({ key: 'opening-progress:' + control.sessionId, status: 'success', title: 'Opening progress loaded', summary: 'Continue from the authoritative opening progress file.', anchors: [OPENING_CONTROL_PATH, OPENING_PROGRESS_PATH], exact: { sessionId: control.sessionId, sourceHash: control.sourceHash, revision: normalized.revision, phase: normalized.phase } });
  return { control: control.value, progress: normalized };
}
return readOpeningProgress(input, tsian, signal);
