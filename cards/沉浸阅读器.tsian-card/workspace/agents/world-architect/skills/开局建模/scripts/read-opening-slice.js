async function readOpeningSlice(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    const source = await loadSource(tsian);
    const startIndex = normalizePositiveInt(input && input.startIndex, 1, 1, Math.max(1, source.chapters.length));
    const defaultEnd = Math.min(source.chapters.length, startIndex + 2);
    const endIndex = normalizePositiveInt(input && input.endIndex, defaultEnd, startIndex, source.chapters.length);
    const maxCharacters = normalizePositiveInt(input && input.maxCharacters, 60000, 4000, 120000);
    let totalCharacters = 0;
    const selectedChapters = [];
    const parts = [];
    for (const chapter of source.chapters.slice(startIndex - 1, endIndex)) {
      signal.throwIfAborted();
      const content = await readText(tsian, chapter.path);
      const cleaned = cleanText(content);
      const remaining = maxCharacters - totalCharacters;
      if (remaining <= 0) break;
      const used = cleaned.length > remaining ? cleaned.slice(0, remaining) : cleaned;
      totalCharacters += used.length;
      selectedChapters.push({ ...chapter, charactersRead: used.length, truncated: used.length < cleaned.length });
      var body = used;
      var nl = body.indexOf('\n');
      var firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === chapter.title) { body = nl === -1 ? '' : body.slice(nl + 1).replace(/^\s+/, ''); }
      parts.push('# ' + chapter.title + '\n\n' + body);
      if (totalCharacters >= maxCharacters) break;
    }
    const result = { schema: OPENING_SCHEMA, window: { startIndex, endIndex: selectedChapters.length ? selectedChapters[selectedChapters.length - 1].index : startIndex, maxCharacters, totalCharacters, chapters: selectedChapters }, text: parts.join('\n\n') };
    tsian.trace('opening_slice_read', { startIndex: result.window.startIndex, endIndex: result.window.endIndex, totalCharacters, chapterCount: selectedChapters.length });
    return result;
  } catch (error) {
    tsian.trace('opening_slice_read_failed', { code: error && error.code || 'OPENING_SLICE_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return readOpeningSlice(input, tsian, signal);
