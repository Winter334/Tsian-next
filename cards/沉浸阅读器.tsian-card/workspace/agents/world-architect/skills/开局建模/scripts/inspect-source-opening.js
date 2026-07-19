async function inspectSourceOpening(input, tsian, signal) {
  try {
    signal.throwIfAborted();
    const previewCount = normalizePositiveInt(input && input.previewCount, 8, 1, 20);
    const previewCharacters = normalizePositiveInt(input && input.previewCharacters, 700, 120, 2000);
    const source = await loadSource(tsian);
    const cache = new Map();
    const earlyChapters = [];
    for (const chapter of source.chapters.slice(0, previewCount)) {
      signal.throwIfAborted();
      const content = await readSourceChapter(tsian, chapter, cache);
      earlyChapters.push({ ...compactSourceChapter(chapter), preview: clipText(content, previewCharacters) });
    }
    const result = { schema: OPENING_SCHEMA, title: source.manifest.title || '导入小说', totalCharacters: source.manifest.totalCharacters || 0, chapterCount: source.chapters.length, earlyChapters };
    tsian.trace('opening_source_inspected', { title: result.title, chapterCount: result.chapterCount, previewCount: earlyChapters.length });
    return result;
  } catch (error) {
    tsian.trace('opening_source_inspect_failed', { code: error && error.code || 'OPENING_INSPECT_FAILED', message: error && error.message || String(error), details: error && error.details });
    throw error;
  }
}
return inspectSourceOpening(input, tsian, signal);
