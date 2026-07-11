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

## Common imports

```ts
import { createTsian, parseStoryOptions } from "@tsian/play-bridge"
import type { TsianApi, MessageDelta, TurnEndResult } from "@tsian/play-bridge"
```

Full API reference lives in the Tsian repository at `docs/sdk/play-frontend-api.md`.
