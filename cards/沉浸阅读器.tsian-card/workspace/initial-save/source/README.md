# Source Corpus

Imported novel text belongs here. The source corpus is author reference for canon characters, causal context and style, and for world/schema adaptation. Settled playthrough facts are maintained separately after the prose.

Current imports write a manifest, a chapter index, and shard-backed source text. Agents should use source-reading actions and chapter refs rather than assuming any storage layout.

Layout:

```text
save/source/manifest.json
save/source/chapters.index.json
save/source/shards/source-shard-0001.md
save/source/shards/source-shard-0002.md
```

Use the shared 原著阅读 Skill to locate chapters and read contiguous text. The storyteller bookmark is only a retrieval starting point, never a plot lock or an alignment requirement.
