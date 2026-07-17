# Research: Provider Model Fetch and Tool Probe

## Gemini model list

Source: Google Gemini API docs fetched 2026-07-17.

- REST endpoint: `GET https://generativelanguage.googleapis.com/v1beta/models`.
- Auth examples support `x-goog-api-key`; some docs/examples also show API-key query usage. Current Tsian code already sends `x-goog-api-key`.
- Query parameters:
  - `pageSize`: documented max 1000.
  - `pageToken`: continuation token.
- Response shape:
  ```json
  {
    "models": [
      {
        "name": "models/gemini-...",
        "supportedGenerationMethods": ["generateContent"]
      }
    ],
    "nextPageToken": "..."
  }
  ```
- Model list should prefer entries whose `supportedGenerationMethods` includes `generateContent`. If the field is absent (proxy or non-standard response), do not drop the model solely for that reason.

## Anthropic model list

Source: Anthropic docs fetched 2026-07-17.

- REST endpoint: `GET https://api.anthropic.com/v1/models`.
- Auth headers: `x-api-key`, `anthropic-version: 2023-06-01`.
- Response shape: `{ data: ModelInfo[], first_id, has_more, last_id }`.
- Existing generic `data[]` extraction matches this first-page response shape. Pagination is outside this task unless needed by a failing test.

## Product decisions from user

- Base URL normalization should stay minimal: trim, add `https://`, remove trailing slash, and strip obvious endpoint suffixes. Do not add provider-specific guesses or middleman-protocol diagnostics.
- Tool-call test results are MVP session-only UI feedback. Do not persist results or add model-list badges.
