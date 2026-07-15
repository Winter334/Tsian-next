# 通用 Agent 回复正则投影系统

## Goal

Introduce a platform-side, content-agnostic reply projection pipeline similar to Tavern regex replacement but adapted for Tsian's custom frontend model. Agent raw replies should be transformable into clean LLM context text, display-oriented content, and optional arbitrary projection data without making platform schemas understand gameplay concepts such as options, cards, HUDs, or HTML blocks.

## Background / Decisions

- User decision: options are part of assistant content, not a platform-owned structured field.
- User decision: frontends can be fully custom and may render Markdown, HTML, DSL, components, or any other card-defined format.
- User decision: platform should provide projection capability but not content-specific semantics.
- User decision: security defenses for user/community-authored regex, HTML, DSL, or ReDoS are out of scope for this personal/non-commercial project.
- Architectural insight: extracting matched content only into a side field is insufficient for inline rendering because it loses the original position in the narrative. A display projection text is needed.

## Requirements

- R1: Add a generic reply projection concept that can transform an Agent raw reply before persistence.
- R2: The projection pipeline must support at least two text products:
  - `content`: clean text suitable for `context.json`, compression, semantic indexing, and fallback display.
  - `displayContent`: display-oriented text preserving inline replacement positions and supporting card/frontend-defined formats such as HTML or DSL.
- R3: The projection pipeline should support optional arbitrary JSON `projections` keyed by card/frontend conventions. Platform stores these values but does not interpret their semantics.
- R4: The player-turn Agent context must receive clean `content`, not UI-only tags, option blocks, HTML/DSL replacements, or projection side data.
- R5: Turn history should retain enough display projection information for frontends to render the reply without reparsing clean context.
- R6: No first-class platform `options` field should be introduced. A default option parser/projection may exist as a rule, but not as a platform schema concept.
- R7: Rules should be configurable rather than hardcoded to one frontend behavior. Exact storage/authorship UI is a design decision for this child task.
- R8: The design must cover both normal formal turns and opening turn 0 once child A has made opening history-based.
- R9: Platform should not sanitize, sandbox, warn about, or otherwise police rule-generated HTML/DSL/projection content as part of this task.

## Acceptance Criteria

- [ ] A raw assistant reply can be persisted as clean `content` plus optional `displayContent` and `projections` on the turn assistant timeline item.
- [ ] The same clean `content` is what gets appended to player-turn Agent context.
- [ ] A rule can remove UI-only markup from `content` while replacing it inline in `displayContent`.
- [ ] A rule can optionally write JSON-compatible projection data under a caller-defined key.
- [ ] Default frontend rendering can fall back to `content` when no `displayContent` exists, and can prefer `displayContent` when present.
- [ ] The implementation does not add a platform-specific options schema field.
- [ ] Build/type validation passes for every package whose contracts or runtime shapes change.

## Open Questions

- OQ1: Where should projection rules be authored and stored: game-card content, save-local player config, frontend package config, or a layered combination?
- OQ2: Should raw model replies be stored durably for debug/re-projection, or should AI debug records remain the only raw-output source?
- OQ3: What minimum rule language is needed for v1: regex replace only, regex plus capture-to-JSON, or a richer template/DSL from the start?

## Out of Scope

- XSS, sanitizer, import warning, or ReDoS defenses.
- Making any gameplay-specific projection key mandatory.
- Implementing a specialized option system separate from generic projection rules.
