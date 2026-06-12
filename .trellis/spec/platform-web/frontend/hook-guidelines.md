# Composable Guidelines

Composables are for reusable Vue state and UI coordination. They should not hide platform persistence or Agent Runtime side effects unless the composable name and scope make that explicit.

## Rules

- Return explicit commands for domain mutations; callers decide when to save or refresh.
- Keep Dexie writes in storage helpers or platform-host APIs.
- Keep model calls in platform-host/runtime-host, not in composables.
- Clear timers and subscriptions in `onBeforeUnmount`.

## Avoid

- Do not create composables that mutate global singleton state without making that explicit.
- Do not bypass bridge/platform APIs from play frontend code.
- Do not use composables to recreate workflow editor state for the retired DAG system.
