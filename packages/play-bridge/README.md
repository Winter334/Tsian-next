# @tsian/play-bridge

Frontend SDK for Tsian game frontends.

`@tsian/play-bridge` wraps the Tsian play iframe bridge into a domain-level API for game frontend authors:

```ts
import { createTsian } from "@tsian/play-bridge"

const tsian = createTsian()
await tsian.waitForReady()
await tsian.send("我推开酒馆的门")
```

It is intended to be used inside Tsian packaged or remote game frontends loaded by the platform. The SDK handles the `postMessage` handshake and RPC details internally.

## Frontend Actions

A card frontend can invoke a card-owned Frontend Action through the semantic card API. Inputs and outputs must be strict JSON values. Before input crosses `postMessage`, and again before host output is returned to the caller, the SDK enforces the same hard transport limits as the host:

- compact serialized strict JSON: at most 1 MiB (UTF-8 bytes, including JSON escaping);
- maximum depth: 64, with the root at depth 0;
- maximum nodes: 100,000, including the root.

Values that would be lost or changed by JSON serialization are rejected rather than coerced. This includes `undefined`, BigInt, functions, symbols, non-finite numbers, cycles, sparse or accessor-backed arrays, accessor/symbol/non-enumerable properties, and exotic objects such as `Date`, `Map`, or class instances.

```ts
import { createTsian, FrontendActionError } from "@tsian/play-bridge"

const tsian = createTsian()
await tsian.waitForReady()

const controller = new AbortController()

try {
  const result = await tsian.card.runAction(
    "equip-item",
    { itemId: "iron-sword" },
    { signal: controller.signal },
  )
  console.log(result)
} catch (error) {
  if (error instanceof FrontendActionError) {
    // Use kind + code to distinguish platform failures from card domain errors.
    console.error(error.kind, error.code, error.message, error.details)
  }
}
```

Aborting the signal requests cancellation of that invocation. A signal that is already aborted rejects without sending the run request. If a durable commit has already completed, its successful result remains authoritative.

Subscribe to successful, non-empty Workspace commits and re-read affected state as needed:

```ts
const unsubscribe = tsian.onWorkspaceMutation((event) => {
  console.log(event.actionId, event.writtenPaths, event.deletedPaths)
})

// Later:
unsubscribe()
```

Mutation events contain paths and correlation identifiers only, never file content. The SDK delivers an event only when it is a strict, closed JSON object with exact `source: "frontend-action"`, valid invocation/action/save identifiers, a non-empty mutation, and dense string path arrays that are already trimmed, duplicate-free, and stably sorted. Malformed transport events are ignored; valid events remain path-only invalidation signals, so subscribers should authoritatively re-read every affected dependency.

Public Action failures are accepted only as closed strict-JSON envelopes with a stable runtime code or domain code matching `[A-Z][A-Z0-9_]{0,63}`, a non-empty message of at most 500 characters, and an optional correlation id of at most 128 characters matching the host identifier grammar. Domain `details` is limited to 64 KiB, depth 16, and 100,000 nodes; runtime `details` uses the normal 1 MiB/depth-64/node-100,000 transport limits. Invalid error envelopes are sanitized to `FRONTEND_ACTION_EXECUTION_FAILED` and their raw content is not exposed.

## Common imports

```ts
import { createTsian, parseStoryOptions } from "@tsian/play-bridge"
import type { TsianApi, MessageDelta, TurnEndResult } from "@tsian/play-bridge"
```

Full API reference lives in the Tsian repository at `docs/sdk/play-frontend-api.md`.
