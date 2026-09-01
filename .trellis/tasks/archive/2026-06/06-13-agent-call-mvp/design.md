# Design

## Architecture

`agent_call` is a first-class Agent Runtime workspace tool. It is not a Skill action.

```text
root turn
  -> master agent step
     -> workspace tools
        -> agent_call(memory)
           -> validate contacts / budget / target
           -> assemble memory agent context
           -> run delegated memory agent step
              -> workspace tools / skill_load / non-agent_call action_call allowed
              -> nested agent_call rejected
           -> return structured observation to master
  -> narrative agent step
```

The Agent Runtime owns orchestration and prompt composition. `platform-host` continues to own persistence, model capability injection, trace persistence, and platform actions. `agent-runtime` must not import Dexie, storage helpers, bridge objects, or `platform-host`.

## Runtime Tool Boundary

`agent_call` qualifies as a platform runtime primitive because it needs:

- Agent registry and contacts;
- target Agent context assembly;
- model invocation through injected capability;
- turn-scoped call budget and nesting policy;
- trace;
- current turn history/context policy.

Gameplay-specific collaboration strategy remains in `AGENT.md` and future Skills. The runtime primitive only provides the safe dispatch mechanism.

## Tool Signature

Textual tool call:

```md
<tsian-tool-call>
{"name":"agent_call","arguments":{"agentId":"memory","request":"Check continuity for the current scene.","historyMode":"scene"}}
</tsian-tool-call>
```

Arguments:

```ts
interface AgentCallArguments {
  agentId: string
  request: string
  reason?: string
  contextSummary?: string
  expectedOutput?: string
  historyMode?: "minimal" | "recent" | "scene"
}
```

Structured success observation:

```ts
interface AgentCallObservation {
  status: "completed"
  targetAgent: {
    id: string
    title: string
    summary: string
  }
  historyMode: "minimal" | "recent" | "scene"
  response: string
}
```

The observation returns the delegated Agent response to the caller. It does not persist to player history by itself.

## Exposure Rules

`agent_call` is shown in runtime tool instructions only when:

- the current Agent has at least one contact;
- the current tool context allows `agent_call` for this step.

The tool instructions should list only the current Agent's visible contacts with id/title/summary. Do not expose the full Agent registry.

Direct calls are still validated even if the tool was not encouraged in instructions.

## Validation And Error Codes

- Missing / blank `agentId` -> `AGENT_CALL_TARGET_REQUIRED`.
- Missing / blank `request` -> `AGENT_CALL_REQUEST_REQUIRED`.
- Invalid `historyMode` -> `AGENT_CALL_HISTORY_MODE_INVALID`.
- Current Agent has no active context -> `AGENT_CALL_CONTEXT_REQUIRED`.
- `agent_call` disabled for this step -> `AGENT_CALL_UNAVAILABLE`.
- Target Agent is not in caller contacts -> `AGENT_CALL_TARGET_NOT_CONTACT`.
- Target Agent not found -> `AGENT_CALL_TARGET_NOT_FOUND`.
- Per-turn call budget exhausted -> `AGENT_CALL_LIMIT_EXCEEDED`.
- Delegated Agent throws -> `AGENT_CALL_FAILED`, with summarized error.

Nested `agent_call` in delegated steps returns `AGENT_CALL_UNAVAILABLE` for the MVP.

## Context Strategy

`agent_call` must not pass full raw history by default.

Delegated Agent prompt order:

1. Stable prefix:
   - platform guard for delegated Agent work;
   - runtime tool instructions for that Agent;
   - target `AGENT.md`;
   - target Agent context, notes/session, contextPaths, Skill Index.
2. Cold context:
   - current timeline / memory summaries / world facts from target contextPaths.
3. Hot context:
   - caller Agent id/title;
   - request, reason, contextSummary, expectedOutput;
   - current turn number;
   - history window selected by `historyMode`;
   - current player input.
4. Tool observations from delegated Agent's own tool loop.

`historyMode` is semantic. Concrete message counts are platform policy:

- `minimal`: no raw recent history by default.
- `recent`: current default short recent window.
- `scene`: larger recent window for current-scene continuity.

The concrete counts should be constants inside `agent-runtime` and can change without changing the tool API.

## Delegated Agent Capabilities

For MVP, a delegated Agent may use:

- `workspace_read`;
- `workspace_list`;
- `workspace_search`;
- `skill_load`;
- `action_call` for loaded Skills.

For MVP, a delegated Agent may not use:

- nested `agent_call`;
- platform actions not already allowed through `action_call` / `platform_action`;
- direct persistence outside existing platform action boundaries.

This keeps memory/state/rules Agent useful without opening recursive team behavior.

## Turn Budget

Recommended MVP constants:

- maximum `agent_call` invocations per root turn: 4;
- maximum delegated Agent depth: 1;
- delegated Agent tool rounds: reuse current per-Agent workspace tool round cap.

The budget should be turn-scoped across master and narrative steps, not local to a single model call. This prevents master and narrative from each exhausting a separate quota unnoticed.

## Default Workspace Changes

New saves should include:

```text
agents/memory/
  AGENT.md
  notes.md
  session.jsonl
```

Default `agents/master/AGENT.md` should:

- include `memory` in contacts;
- say when to contact memory;
- encourage `historyMode: "scene"` only when continuity requires it.

Default `agents/memory/AGENT.md` should focus on:

- continuity checks;
- current-scene summary suggestions;
- long-term memory suggestions;
- facts worth preserving.

The MVP should not automatically write memory files. Memory writes remain future Skill/action work.

## Trace

Add trace coverage for `agent_call`.

Recommended event:

```ts
{
  type: "agent_called",
  agentId: "master",
  debugLabel: "master-agent",
  ok: true,
  data: {
    targetAgentId: "memory",
    targetAgentTitle: "Memory Agent",
    historyMode: "scene",
    inputSummary: { jsonLength: 128, keys: ["agentId", "request", "historyMode"] },
    outputSummary: { type: "string", stringLength: 420, jsonLength: 422 }
  }
}
```

Delegated Agent model calls should still emit `model_call_completed` with target `agentId` and a generated debug label such as `agent:memory`.

If delegated Agent execution fails, `agent_called` should be `ok: false` with a summarized error. The caller receives a structured error observation.

## Compatibility

Prototype stage: no migrations.

Existing non-empty saves will not automatically receive `memory` Agent unless future code explicitly repairs workspace defaults. For MVP, new saves are enough. If an old save lacks `memory`, `agent_call` to memory returns `AGENT_CALL_TARGET_NOT_FOUND`.

## Trade-Offs

- Runtime tool instead of Skill action makes Agent collaboration a first-class AIRP primitive, but requires keeping the primitive small and contacts-gated.
- Semantic `historyMode` keeps the API simple, but exact message counts are less controllable by authors until later configuration surfaces exist.
- Disallowing nested `agent_call` reduces expressive power, but avoids loops and trace complexity during MVP.
- Adding default `memory` Agent improves default demonstration, but memory persistence remains a future task.
