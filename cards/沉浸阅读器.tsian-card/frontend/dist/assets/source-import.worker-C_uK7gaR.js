(function() {
  "use strict";
  const CHAPTER_INDEX_PATH = "save/source/chapters.index.json";
  const SOURCE_SHARDS_ROOT = "save/source/shards/";
  const SOURCE_TARGET_SHARD_CHARACTERS = 1e6;
  const NORMALIZATION_VERSION = "novel-source-sharded-v1";
  const PSEUDO_CHAPTER_TARGET = 15e3;
  function excerptText(text, limit = 1100) {
    const cleaned = text.replace(/^#\s+.*\n+/, "").replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length <= limit) return cleaned;
    return `${cleaned.slice(0, limit).trimEnd()}……`;
  }
  function inferTitle(text, fileName) {
    if (fileName) {
      const title = fileName.replace(/\.(txt|md)$/i, "").trim();
      if (title) return title;
    }
    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
    if (!firstLine) return "导入小说";
    return firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine;
  }
  function normalizeNovelText(text) {
    const normalized = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
    return normalized ? `${normalized}
` : "";
  }
  function isBoundaryLine(lines, index) {
    var _a, _b;
    const prev = index <= 0 ? "" : ((_a = lines[index - 1]) == null ? void 0 : _a.trim()) ?? "";
    const next = index >= lines.length - 1 ? "" : ((_b = lines[index + 1]) == null ? void 0 : _b.trim()) ?? "";
    return !prev || !next;
  }
  function toAsciiDigits(value) {
    return value.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 65296));
  }
  function classifyChapterLine(rawLine, lines, index) {
    const line = rawLine.trim().replace(/^#+\s*/, "");
    if (!line || line.length > 60) return null;
    const strong = /^(第[零〇一二两三四五六七八九十百千万0-9０-９]+\s*[章节回卷集部幕节篇](?:\s+.*)?|Chapter\s+[0-9IVXLCDM]+(?:\s+.*)?)$/i;
    if (strong.test(line)) {
      return { title: line, confidence: "strong" };
    }
    const medium = /^(序章|序幕|楔子|引子|后记|尾声|番外(?:[零〇一二两三四五六七八九十百千万0-9０-９]+)?|第[零〇一二两三四五六七八九十百千万0-9０-９]+卷(?:\s+.*)?|卷[零〇一二两三四五六七八九十百千万0-9０-９]+(?:\s+.*)?|正文\s+第[零〇一二两三四五六七八九十百千万0-9０-９]+\s*[章节回卷集部幕节篇].*)$/;
    if (medium.test(line) && isBoundaryLine(lines, index) && !/[。？！]$/.test(line)) {
      return { title: line, confidence: "medium" };
    }
    const weak = /^([0-9０-９]{1,4})[、.．\s]+(.{0,50})$/;
    const weakMatch = line.match(weak);
    if (weakMatch && isBoundaryLine(lines, index) && !/[。？！"”’』」]$/.test(line)) {
      return {
        title: line,
        confidence: "weak",
        numeric: Number(toAsciiDigits(weakMatch[1] ?? ""))
      };
    }
    return null;
  }
  function findChapterCandidates(text) {
    const lines = text.split("\n");
    const offsets = [];
    let offset = 0;
    for (const line of lines) {
      offsets.push(offset);
      offset += line.length + 1;
    }
    const candidates = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const found = classifyChapterLine(lines[lineIndex] ?? "", lines, lineIndex);
      if (found) {
        candidates.push({
          lineIndex,
          offset: offsets[lineIndex] ?? 0,
          ...found
        });
      }
    }
    const strongOrMedium = candidates.filter(
      (item) => item.confidence === "strong" || item.confidence === "medium"
    );
    if (strongOrMedium.length >= 2 || strongOrMedium.length === 1 && strongOrMedium[0].offset < 2e3) {
      return {
        candidates: strongOrMedium,
        confidence: strongOrMedium.some((item) => item.confidence === "strong") ? "strong" : "medium"
      };
    }
    const weak = candidates.filter(
      (item) => item.confidence === "weak" && Number.isFinite(item.numeric)
    );
    let sequential = 0;
    for (let index = 1; index < weak.length; index += 1) {
      if (weak[index].numeric === weak[index - 1].numeric + 1) sequential += 1;
    }
    if (weak.length >= 3 && sequential >= 2) {
      return { candidates: weak, confidence: "weak" };
    }
    return { candidates: [], confidence: "none" };
  }
  function splitByCandidates(text, detected) {
    return detected.candidates.map((current, index) => {
      const next = detected.candidates[index + 1];
      return {
        title: current.title,
        content: `${text.slice(current.offset, next ? next.offset : text.length).trim()}
`,
        pseudo: false
      };
    });
  }
  function splitPseudoChapters(text) {
    const paragraphs = text.split(/\n{2,}/);
    const chapters = [];
    let current = [];
    let size = 0;
    const flush = () => {
      if (current.length === 0) return;
      chapters.push({
        title: `片段 ${chapters.length + 1}`,
        content: `${current.join("\n\n").trim()}
`,
        pseudo: true
      });
      current = [];
      size = 0;
    };
    for (const para of paragraphs) {
      const textPara = para.trim();
      if (!textPara) continue;
      if (size > 0 && size + textPara.length > PSEUDO_CHAPTER_TARGET) flush();
      if (textPara.length > PSEUDO_CHAPTER_TARGET * 1.5) {
        for (let start = 0; start < textPara.length; start += PSEUDO_CHAPTER_TARGET) {
          flush();
          chapters.push({
            title: `片段 ${chapters.length + 1}`,
            content: `${textPara.slice(start, start + PSEUDO_CHAPTER_TARGET).trim()}
`,
            pseudo: true
          });
        }
        continue;
      }
      current.push(textPara);
      size += textPara.length;
    }
    flush();
    return chapters.length > 0 ? chapters : [{ title: "片段 1", content: text, pseudo: true }];
  }
  function pad4(num) {
    return String(num).padStart(4, "0");
  }
  function chapterRef(chapterNumber) {
    return `source:chapter-${pad4(chapterNumber)}`;
  }
  function shardId(shardNumber) {
    return `source-shard-${pad4(shardNumber)}`;
  }
  function formatChapterMarkdown(chapter) {
    return chapter.content.trimStart().startsWith("#") ? chapter.content : `# ${chapter.title}

${chapter.content}`;
  }
  function buildShardedCorpusFiles(sourceChapters, onProgress) {
    const shards = [];
    const chapters = [];
    let currentParts = [];
    let currentLength = 0;
    let currentStartChapter = 0;
    let currentEndChapter = 0;
    let currentShardId = "";
    let currentShardPath = "";
    const ensureShard = (chapterNumber) => {
      if (currentParts.length > 0) return;
      currentStartChapter = chapterNumber;
      currentEndChapter = chapterNumber;
      currentShardId = shardId(shards.length + 1);
      currentShardPath = `${SOURCE_SHARDS_ROOT}${currentShardId}.md`;
    };
    const flush = () => {
      if (currentParts.length === 0) return;
      const content = currentParts.join("");
      shards.push({
        id: currentShardId,
        path: currentShardPath,
        startChapter: currentStartChapter,
        endChapter: currentEndChapter,
        characters: content.length,
        content
      });
      onProgress == null ? void 0 : onProgress({
        phase: "sharding",
        message: `构建分片 ${shards.length}…`,
        current: shards.length
      });
      currentParts = [];
      currentLength = 0;
      currentStartChapter = 0;
      currentEndChapter = 0;
      currentShardId = "";
      currentShardPath = "";
    };
    sourceChapters.forEach((chapter, index) => {
      const chapterNumber = index + 1;
      const content = formatChapterMarkdown(chapter);
      const separatorLength = currentParts.length > 0 ? 2 : 0;
      if (currentParts.length > 0 && currentLength + separatorLength + content.length > SOURCE_TARGET_SHARD_CHARACTERS) {
        flush();
      }
      ensureShard(chapterNumber);
      currentEndChapter = chapterNumber;
      const separator = currentParts.length > 0 ? "\n\n" : "";
      const start = currentLength + separator.length;
      if (separator) {
        currentParts.push(separator);
        currentLength += separator.length;
      }
      currentParts.push(content);
      currentLength += content.length;
      const end = currentLength;
      chapters.push({
        index: chapterNumber,
        ref: chapterRef(chapterNumber),
        title: chapter.title,
        characters: excerptText(content, Number.MAX_SAFE_INTEGER).length,
        source: {
          kind: "shard",
          shardId: currentShardId,
          path: currentShardPath,
          start,
          end
        }
      });
      if (chapterNumber % 100 === 0) {
        onProgress == null ? void 0 : onProgress({
          phase: "sharding",
          message: `构建分片 ${shards.length + 1}…`,
          current: chapterNumber,
          total: sourceChapters.length
        });
      }
      if (content.length >= SOURCE_TARGET_SHARD_CHARACTERS) {
        flush();
      }
    });
    flush();
    onProgress == null ? void 0 : onProgress({
      phase: "sharding",
      message: `构建分片 ${shards.length}/${shards.length}…`,
      current: shards.length,
      total: shards.length
    });
    const shardMetas = shards.map(({ content: _content, ...meta }) => meta);
    return { shards, chapters, shardMetas };
  }
  function buildSourceCorpus(rawText, input, onProgress) {
    onProgress == null ? void 0 : onProgress({ phase: "normalizing", message: "整理文本…" });
    const normalized = normalizeNovelText(rawText);
    if (!normalized.trim()) {
      throw new Error("导入文本为空。");
    }
    onProgress == null ? void 0 : onProgress({ phase: "detecting", message: "识别章节…" });
    const detected = findChapterCandidates(normalized);
    const useDetected = detected.candidates.length > 0;
    onProgress == null ? void 0 : onProgress({ phase: "splitting", message: useDetected ? "切分章节…" : "按长度切分片段…" });
    const sourceChapters = useDetected ? splitByCandidates(normalized, detected) : splitPseudoChapters(normalized);
    onProgress == null ? void 0 : onProgress({ phase: "sharding", message: "构建分片…", current: 0 });
    const { shards, chapters, shardMetas } = buildShardedCorpusFiles(sourceChapters, onProgress);
    const manifest = {
      version: 1,
      status: "ready",
      title: input.title || inferTitle(normalized, input.fileName),
      sourceFormat: input.sourceFormat,
      importMode: input.importMode,
      recommendedExtractionMode: input.importMode === "paste" ? "full" : "frontier",
      chapterDetection: useDetected ? "heuristic" : "fallback-length",
      chapterDetectionConfidence: detected.confidence,
      ...input.fileName ? { originalFileName: input.fileName } : {},
      importedAt: (/* @__PURE__ */ new Date()).toISOString(),
      normalizationVersion: NORMALIZATION_VERSION,
      totalCharacters: normalized.length,
      chapterCount: chapters.length,
      files: {
        chaptersIndex: CHAPTER_INDEX_PATH,
        shardsRoot: SOURCE_SHARDS_ROOT
      },
      storage: {
        kind: "sharded",
        targetShardCharacters: SOURCE_TARGET_SHARD_CHARACTERS
      }
    };
    const chapterIndex = {
      version: 2,
      storage: {
        kind: "sharded",
        targetShardCharacters: SOURCE_TARGET_SHARD_CHARACTERS,
        shardsRoot: SOURCE_SHARDS_ROOT
      },
      shards: shardMetas,
      chapters
    };
    onProgress == null ? void 0 : onProgress({ phase: "complete", message: "源文本处理完成", current: shards.length, total: shards.length });
    return { manifest, chapterIndex, shards };
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "导入失败");
  }
  self.onmessage = (event) => {
    const request = event.data;
    if (!request || typeof request.id !== "string") return;
    try {
      const corpus = buildSourceCorpus(
        request.input.text,
        {
          title: request.input.title,
          fileName: request.input.fileName,
          sourceFormat: request.input.sourceFormat,
          importMode: request.input.importMode
        },
        (progress) => {
          self.postMessage({ type: "progress", id: request.id, progress });
        }
      );
      self.postMessage({ type: "complete", id: request.id, corpus });
    } catch (error) {
      self.postMessage({ type: "error", id: request.id, message: errorMessage(error) });
    }
  };
})();
