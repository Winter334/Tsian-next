# Source Corpus

Imported novel text belongs here. The source corpus is the factual basis for derived schema, entities, scenes, and relationships.

Current imports write a manifest, a chapter index, and shard-backed source text. Agents should use source-reading actions and chapter refs rather than assuming any storage layout.

Layout:

```text
save/source/manifest.json
save/source/chapters.index.json
save/source/shards/source-shard-0001.md
save/source/shards/source-shard-0002.md
```

Track progress in `save/playthrough/frontier.json` and expand the source frontier as play needs it.
