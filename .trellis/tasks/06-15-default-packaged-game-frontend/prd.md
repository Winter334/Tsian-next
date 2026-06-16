# Default Packaged Game Frontend

## Goal

Add a default playable game frontend later, using the same packaged frontend path as ordinary Game Cards.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Implement a default game frontend as a built static package, not as a same-realm builtin frontend.
- Bind the built-in blank Game Card to that frontend only when the package is ready.
- Use `frontend.kind === "packaged"` and `tsian.play-bridge.v1`.
- Keep runtime/gameplay rendering semantics in the frontend package, not the platform shell.
- Keep AI debug and platform-only diagnostics out of the game frontend bridge.
- Preserve the ability for Game Cards to use remote or custom packaged frontends.

## Acceptance Criteria

- [ ] Blank Game Card can be seeded with a valid packaged frontend binding.
- [ ] Default frontend files are stored or served through the same packaged frontend mechanism as imported Game Cards.
- [ ] `/play` mounts the default frontend through iframe bridge semantics.
- [ ] The frontend can send player input and read runtime/history data through allowed bridge methods.
- [ ] No same-realm game frontend path is reintroduced.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke verifies default frontend load and at least one message flow when AI config is available.

## Dependencies

- Recommended after card library, package/frontend binding UI, and shell navigation are usable.

## Out Of Scope

- Full polished first-launch world creation.
- Online workshop publishing.
- Gameplay-specific state model hardcoded in platform.
- Reintroducing `builtin` frontend binding.
