# Studio Agent Detail And Skill Assignment Simplification

## Goal

Make the Studio view quieter and easier for ordinary players to understand by removing low-value diagnostic/status information and presenting skills as one unified assignable resource rather than separate shared/private categories.

## User Value

- Players can focus on editing Agents and assigning Skills without reading noisy status metadata.
- Agent details show only information that helps the player make a concrete edit.
- Skills use a single mental model: a Skill is available to one or more Agents, and whether it is effectively shared is derived from assignment count.

## Confirmed Facts

- The user identified the screenshot red-box area as low-value information noise that should be removed.
- The Agent detail fields for contacts, default abilities, and missing context have too little practical meaning and should be removed.
- Skill categories should no longer be modeled in the UI as shared versus dedicated/private.
- A Skill assigned to multiple Agents is effectively shared; a Skill assigned to one Agent is effectively dedicated to that Agent.

## Requirements

- Remove the Studio page information block called out as noisy in the screenshot.
- Remove low-value Agent detail sections:
  - contacts
  - default abilities
  - missing context
- Replace the shared/dedicated Skill distinction with a unified Skill assignment experience.
- Existing Skill assignment behavior should remain understandable for current data.
- Avoid adding developer/debug language or extra explanatory clutter to the player-facing UI.
- Keep the change scoped to Studio UI and local state semantics needed to support it.

## Acceptance Criteria

- [x] The Studio page no longer shows the screenshot red-box information block.
- [x] Agent detail no longer displays contacts, default abilities, or missing context.
- [x] Skill UI presents skills as one unified collection instead of shared/private groups.
- [x] Skill assignment lets players see which Agents receive a Skill and keeps the existing edit entrypoint for changing the underlying definition.
- [x] Existing cards/workspace data do not break when opened after the UI simplification.
- [x] The web build passes.

## Out Of Scope

- Redesigning the entire Studio application.
- Changing runtime Agent execution semantics.
- Adding simultaneous multi-card loading or new desktop apps.
