# OpenAI Responses API Notes

## Sources

- OpenAI Responses create reference: https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI streaming guide: https://developers.openai.com/api/docs/guides/streaming-responses
- OpenAI Node SDK response types: https://github.com/openai/openai-node/blob/master/src/resources/responses/responses.ts

## Endpoint And Core Request Fields

- Endpoint: `POST {baseUrl}/responses`.
- Common fields relevant to Tsian:
  - `model: string`
  - `input: string | ResponseInputItem[]`
  - `tools?: Tool[]`
  - `stream?: boolean`
  - `max_output_tokens?: number`
  - `temperature?: number`
  - `top_p?: number`
  - `reasoning?: { effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"; summary?: "auto" | "concise" | "detailed" }`
  - `parallel_tool_calls?: boolean`
  - `store?: boolean`
  - `previous_response_id?: string`

## Function Tools

Responses function tools use a flat shape, not Chat Completions `function` nesting:

```json
{
  "type": "function",
  "name": "get_weather",
  "description": "Retrieves current weather for the given location.",
  "parameters": {
    "type": "object",
    "properties": {
      "location": { "type": "string" }
    },
    "required": ["location"],
    "additionalProperties": false
  }
}
```

`strict: true` is optional. Avoid setting it by default unless all platform tool schemas are strict-compatible.

## Input Item Shapes

Message input:

```ts
{
  type?: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: string | ResponseInputContent[]
}
```

Content parts:

```ts
{ type: "input_text", text: string }
{ type: "input_image", detail: "low" | "high" | "auto" | "original", image_url?: string }
```

Prior function call item, used when replaying `response.output` manually:

```ts
{
  type: "function_call"
  name: string
  arguments: string
  call_id: string
  id?: string
  status?: "in_progress" | "completed" | "incomplete"
}
```

Function call output item:

```ts
{
  type: "function_call_output"
  call_id: string
  output: string
  status?: "in_progress" | "completed" | "incomplete"
}
```

Important Tsian mapping: internal `NativeToolCall.id` should be the Responses `call_id`, because the subsequent `function_call_output.call_id` must match it. The Responses output item `id` (`fc_...`) is not the same contract.

## Non-Streaming Response

Top-level response includes:

```ts
{
  id: string
  object: "response"
  status?: "completed" | "failed" | "in_progress" | "cancelled" | "queued" | "incomplete"
  output_text: string
  output: ResponseOutputItem[]
  error: { code?: string | null, message: string, param?: string | null } | null
  incomplete_details?: { reason: "max_output_tokens" | "content_filter" } | null
  usage?: ResponseUsage
}
```

Text usually appears in a message output item:

```ts
{
  type: "message"
  role: "assistant"
  content: [
    { type: "output_text", text: string, annotations: [] }
  ]
}
```

Function calls appear in `response.output`:

```ts
{
  type: "function_call",
  id: "fc_...",
  call_id: "call_...",
  name: "get_weather",
  arguments: "{\"location\":\"Paris, France\"}"
}
```

## Streaming SSE Events

With `stream: true`, event names generally match `data.type`.

Text delta:

```ts
{
  type: "response.output_text.delta"
  item_id: string
  output_index: number
  content_index: number
  delta: string
}
```

Text done:

```ts
{
  type: "response.output_text.done"
  item_id: string
  output_index: number
  content_index: number
  text: string
}
```

Function call metadata:

```ts
{
  type: "response.output_item.added"
  output_index: number
  item: ResponseOutputItem
}
```

Function call arguments delta:

```ts
{
  type: "response.function_call_arguments.delta"
  item_id: string
  output_index: number
  delta: string
}
```

Function call arguments done:

```ts
{
  type: "response.function_call_arguments.done"
  item_id: string
  output_index: number
  name: string
  arguments: string
}
```

Completed:

```ts
{
  type: "response.completed"
  response: Response
}
```

Errors / terminal failures:

```ts
{ type: "error", code: string | null, message: string, param: string | null }
{ type: "response.failed", response: Response }
{ type: "response.incomplete", response: Response }
```

## Usage Shape

```ts
{
  input_tokens: number
  input_tokens_details: { cached_tokens: number }
  output_tokens: number
  output_tokens_details: { reasoning_tokens: number }
  total_tokens: number
}
```

This differs from Chat Completions cache details (`prompt_tokens_details.cached_tokens`), so Tsian usage extraction should check `input_tokens_details.cached_tokens` for the Responses provider kind.
