# Research: Deterministic Equipment Management

## Current state

The repository currently carries an unshipped interim equipment model across AIRP documents, default Workspace seeds, Stage Manager prompts, formal-card Workspace resources, and `apps/play-frontend-dev` parsing/rendering. That model uses concrete/dynamic slot names, `item.equipment.slot`, string `mods`, ordered operator evaluation, and per-slot applied snapshots. It can be replaced directly because no compatibility commitment or production save migration exists.

The current character-detail redesign already provides the intended UI shell:

- persistent `角色 / 物品` modes;
- portrait-centered stage;
- read-only equipment slot rendering;
- unified inventory cells and in-place container drill-in;
- desktop/mobile independent scrolling and accessible dialogs.

The new work should extend these surfaces rather than redesign them again.

## Chosen model

Character equipment is grouped by slot type and uses fixed-length arrays. Item equipment uses flat `add` and `percent` maps. Slot names, operator strings, formulas, and baseAttributes are removed. Every item reads the same non-equipment baseline and produces an independent contribution.

The complete rational expression must be rounded once. This matters for negative percentages:

```text
baseline = 1, add = 2, percent = -50
roundAway(2 + 1 * -50 / 100) = roundAway(1.5) = 2
```

Rounding the percentage portion first would incorrectly produce 1. Use BigInt numerator arithmetic and convert only checked safe-integer outputs back to JSON numbers.

## Projection semantics

`applied` is not authored input to a modifier formula; it is the stored contribution snapshot needed to reconstruct the current non-equipment baseline from active attributes. The invariant is:

```text
attributes = baseline + sum(applied)
```

A refresh first validates and subtracts all stored old applied values exactly as stored, applies optional non-equipment attribute deltas, clears structurally valid stale projection, then recalculates every valid occupied slot from that one post-change baseline. Missing applied is empty; unknown applied keys and applied on null slots are corruption. Stale refs can be cleared only by refresh. Malformed numeric/projection/container data is corruption and fails the whole operation. Shared Action/Skill parity covers equip/unequip only; refresh has a Skill-only vector suite because the Frontend Action v1 does not expose refresh.

Normalization decisions:

- preserve character attribute key order;
- preserve equipment slot-type key order and all array positions;
- empty slot is `{ ref: null }`;
- omit zero applied keys;
- omit applied when no contributions remain;
- never create unknown attributes as a side effect.

## Ownership semantics

Equipment remains inventory data, not a second virtual store. Reachability is computed from character-exclusive containers. A shared container reached by two paths within one graph is counted once; a container owned by multiple characters is corruption. Count controls how many slots may refer to one homogeneous item entity. Stateful copies require separate refs.

## Resource architecture

Publish card Frontend Action `equipment` with preview/commit equip/unequip. Add a Stage Manager agent-local Skill at `agents/stage-manager/skills/装备管理/` with equip/unequip/refresh. Seed both resources in the internal default AIRP Workspace and mirror them in the formal card Workspace. Each resource carries its own deterministic implementation so it remains distributable. Shared mutation vectors constrain equip/unequip parity; Skill-only vectors constrain refresh. Do not place the formula in Vue or make the Skill depend on the frontend action directory.

## Publication boundary

Update internal Workspace templates and the formal card Workspace, including its `workspaceFiles` inventory. Update `apps/play-frontend-dev` for the source-of-truth development UI. Per the explicit prior decision, do not manually synchronize the formal card packaged `frontend/**` or `frontendFiles`; that remains a later import/package operation.

## Principal risks

- Reconstructing baseline from malformed old applied must fail before writes.
- A single item ref may legally appear in multiple slots up to reachable count; a blanket unique-ref rule is wrong.
- Repeated container paths must not inflate count.
- equip/unequip must not opportunistically clean unrelated stale slots, or preview becomes a hidden repair operation.
- key sorting during normalization would create noisy entity rewrites and violate authored order preservation.
- Frontend preview can become stale between calls, so commit must carry expectedCurrentRef and still rely on platform read-set CAS.
- Updating formal-card Workspace files without rebuilding `workspaceFiles` would produce a broken card package.
