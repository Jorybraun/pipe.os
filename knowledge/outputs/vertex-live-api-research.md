# Research: Vertex AI Live API Model IDs + Cloudflare DO Outbound WebSocket

**Date:** 2026-04-16
**Scope:** Two production debugging questions for the Cloudflare Durable Object that proxies audio to Vertex AI BidiGenerateContent.

---

## Question 1: Correct Model ID for Vertex AI Live API (BidiGenerateContent)

### Finding: The model IDs you tried are wrong for 2025-2026

The three IDs you tried all fail for distinct reasons:

| Model ID tried | Why it fails |
|---|---|
| `gemini-2.0-flash-live-001` | This is the Gemini Developer API name (`generativelanguage.googleapis.com`). Not valid on Vertex AI aiplatform endpoints. [S1] |
| `gemini-2.0-flash-exp` | Experimental model, expired/removed from Vertex AI. [S2] |
| `gemini-2.0-flash` | The base Flash model does not expose the BidiGenerateContent Live API on Vertex AI. Confirmed "not found" by the community forum. [S1] |

### Current valid model IDs (Vertex AI, BidiGenerateContent, 2025-2026)

Two model IDs are confirmed valid on Vertex AI's `aiplatform.googleapis.com` endpoint [S3][S4][S5]:

**Primary (GA — use this):**
```
gemini-live-2.5-flash-native-audio
```
- Status: Generally Available as of 2025.
- Capabilities: Native audio in/out, VAD, multilingual, affective dialog, tool use.

**Secondary (preview, deprecated — do NOT use for new builds):**
```
gemini-live-2.5-flash-preview-native-audio-09-2025
```
- Status: Public Preview, **deprecated and removed March 19, 2026**.
- Do not use this for any new code.

**Older preview (still cited in some docs, region-limited):**
```
gemini-2.0-flash-live-preview-04-09
```
- Referenced in the official Gemini Live API reference page and the GoogleCloudPlatform/generative-ai notebook [S6][S7].
- Community report: only works on `us-central1` [S1].
- This is a 2.0 generation model; prefer `gemini-live-2.5-flash-native-audio` for new work.

**Also reported working by community (region-limited):**
```
gemini-2.0-flash-live-001
```
- Reported working on Vertex AI (NOT the Developer API) in some EU regions [S1].
- Not referenced in current official docs — treat as unstable.

### Correct full setup message

The model field requires the full resource path [S4][S5]:

```json
{
  "setup": {
    "model": "projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio",
    "system_instruction": {
      "parts": [{ "text": "Your system prompt here" }]
    },
    "generation_config": {
      "response_modalities": ["AUDIO"],
      "speech_config": {
        "voice_config": {
          "prebuilt_voice_config": { "voice_name": "Kore" }
        }
      }
    }
  }
}
```

### Correct WebSocket endpoint

From the official start-manage-session docs and the GoogleCloudPlatform notebook [S4][S5]:

```
wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
```

Note: this uses **v1**, not v1beta1. The `Authorization: Bearer {OAUTH_TOKEN}` header goes in the WebSocket handshake headers (not in the URL as `access_token=`).

**Example for `us-central1`:**
```
wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
```

### Complete Python reference example (from GoogleCloudPlatform notebook [S5])

```python
import asyncio
import websockets
import json

PROJECT_ID = "YOUR_PROJECT_ID"
LOCATION = "us-central1"
MODEL_ID = "gemini-live-2.5-flash-native-audio"
MODEL = f"projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}"
config = {"response_modalities": ["audio"]}

HOST = f"{LOCATION}-aiplatform.googleapis.com"
URI = f"wss://{HOST}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"

async def main():
    # Access token from gcloud auth application-default print-access-token
    ACCESS_TOKEN = "..."
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}"}
    async with websockets.connect(URI, additional_headers=headers) as ws:
        print("Session established.")
        await ws.send(json.dumps({
            "setup": {
                "model": MODEL,
                "generation_config": config
            }
        }))
        # Wait for setup complete before sending audio
        setup_response = await ws.recv()
        print("Setup complete:", setup_response)
```

---

## Question 2: Cloudflare Durable Object Outbound WebSocket — `ws.accept()` requirement

### Finding: The problem is which construction pattern you used

There are two distinct ways to create an outbound WebSocket in a Cloudflare Worker/DO, with different `accept()` requirements:

| Construction method | accept() required? | Notes |
|---|---|---|
| `new WebSocket(url)` | **No — auto-accepted** | Standard browser-style constructor. Workers runtime auto-accepts. Cannot pass `allowHalfOpen`. [S8][S9] |
| `fetch(url, { headers: { Upgrade: 'websocket' } })` then `resp.webSocket` | **YES — required** | Cloudflare-specific pattern. Must call `ws.accept()` before `send()` or adding listeners. Supports `allowHalfOpen`. [S9][S10] |

### The TypeError you're seeing

```
TypeError: You must call one of accept() or state.acceptWebSocket() on this WebSocket before sending messages.
```

This error occurs when you use the **`fetch()` + Upgrade pattern** but call `ws.send()` before `ws.accept()`. The fix is straightforward: call `ws.accept()` first.

It does NOT typically occur with `new WebSocket(url)` — that constructor auto-accepts.

**If you are seeing this error with `new WebSocket(url)`**, it means you are either:
1. Mixing up which socket object you're calling `send()` on (the inbound client socket vs the outbound Vertex socket), or
2. Calling `send()` before the `open` event fires (i.e., the connection isn't established yet, not an `accept()` issue but a timing issue).

### Correct pattern: `fetch()` + Upgrade (recommended for outbound to third-party APIs)

This is the canonical Cloudflare pattern for connecting to a third-party WebSocket service [S9][S10]:

```typescript
async function connectToVertexAI(wsUrl: string, token: string): Promise<WebSocket> {
  const resp = await fetch(wsUrl, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Upgrade": "websocket",
    },
  });

  const ws = resp.webSocket;
  if (!ws) {
    throw new Error(`Vertex AI did not return a WebSocket (status ${resp.status})`);
  }

  // REQUIRED before send() or addEventListener() when using fetch() pattern
  ws.accept();

  return ws;
}

// In your Durable Object:
const vertexWs = await connectToVertexAI(wsUrl, accessToken);

// Safe to send now — accept() has been called
vertexWs.addEventListener("open", () => {
  vertexWs.send(JSON.stringify({ setup: { model: MODEL, ... } }));
});

vertexWs.addEventListener("message", (evt) => {
  // relay to inbound client
});
```

### Correct pattern: `new WebSocket(url)` (simpler, but less control)

```typescript
const vertexWs = new WebSocket(wsUrl, undefined, {
  headers: {
    "Authorization": `Bearer ${token}`,
  }
});
// No accept() needed — auto-accepted by Workers runtime

vertexWs.addEventListener("open", () => {
  // Safe to send only after open fires — NOT before
  vertexWs.send(JSON.stringify({ setup: { model: MODEL, ... } }));
});
```

Note: `new WebSocket()` in the Workers runtime supports a third argument for headers (non-standard extension). If your runtime version doesn't support this, you must use the `fetch()` + Upgrade pattern to set custom auth headers.

### Does `ws.accept()` on an outbound socket break anything?

No — calling `ws.accept()` on an outbound socket obtained via `fetch()` + Upgrade does not prevent the connection from completing. It is the required initialization step. The connection handshake has already completed by the time `resp.webSocket` is populated; `accept()` simply tells the Workers runtime "I will handle this socket in JavaScript" [S9][S10].

### Hibernation caveat

Outbound WebSockets created with either pattern do NOT support Cloudflare's WebSocket Hibernation API [S11]. Hibernation is inbound-only (`state.acceptWebSocket()`). This means:
- The DO will be pinned to memory for the duration of the Vertex AI session.
- Duration charges apply regardless of inactivity.
- This is expected and unavoidable for this use case.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | `gemini-2.0-flash-live-preview-04-09` and `gemini-2.0-flash-live-001` work on Vertex AI; base `gemini-2.0-flash` does not; `us-central1` is the most reliable region | Google AI Developers Forum community thread | 2025 | Community forum (anecdotal, multi-user) | Medium — multiple reports, consistent |
| S2 | `gemini-2.0-flash-exp` and other -exp models are deprecated/removed | Gemini deprecation docs + community reports | 2025-2026 | Official docs + community | High |
| S3 | `gemini-live-2.5-flash-native-audio` is the current GA model for Vertex AI Live API | Google Cloud — Gemini 2.5 Flash Live API page | 2025 | Official vendor documentation | High |
| S4 | WebSocket endpoint is `wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent` using v1 (not v1beta1); model path is `projects/.../publishers/google/models/{MODEL_ID}` | Google Cloud — Start and Manage Session docs | 2025 | Official vendor documentation | High |
| S5 | Full Python example using `gemini-live-2.5-flash-native-audio` with BidiGenerateContent via websockets library | GoogleCloudPlatform/generative-ai GitHub notebook | 2025 | Official code sample | High |
| S6 | `gemini-2.0-flash-live-preview-04-09` appears in Gemini Live API reference code examples | Google Cloud — Gemini Live API reference | 2025 | Official vendor documentation | High (but note: older 2.0 generation) |
| S7 | `gemini-live-2.5-flash-preview-native-audio-09-2025` deprecated, removed March 19 2026 | Google Cloud — Gemini 2.5 Flash Live API page | 2025 | Official vendor documentation | High |
| S8 | `new WebSocket(url)` in Workers runtime is auto-accepted; cannot call `accept()` on it | Cloudflare Workers WebSocket runtime API docs | 2024-2025 | Official vendor documentation | High |
| S9 | `fetch()` with `Upgrade: websocket` is the canonical outbound WebSocket pattern; `ws.accept()` is required before `send()` | Cloudflare Workers — Using the WebSockets API example | 2024-2025 | Official vendor documentation | High |
| S10 | `ws.accept()` on outbound socket signals "I will handle this socket in JavaScript"; does not break the connection | Cloudflare Workers — Using the WebSockets API example | 2024-2025 | Official vendor documentation | High |
| S11 | WebSocket Hibernation is not supported for outgoing WebSocket connections; DOs using outbound WS are pinned to memory | Cloudflare Durable Objects — Use WebSockets best practices | 2024-2025 | Official vendor documentation | High |

---

## Direct implications for the project

1. **Change the model ID immediately.** Replace whatever model ID is currently in the DO setup message with `gemini-live-2.5-flash-native-audio` in the full resource path format: `projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`. Use `us-central1` as the location for best availability.

2. **Change the endpoint path to v1 (not v1beta1).** The correct endpoint is `wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`. If you have `v1beta1` in your URL, that may be another source of failure.

3. **The TypeError fix depends on which construction method you use.** If using `fetch()` + Upgrade (recommended, because it lets you set the `Authorization` header): call `ws.accept()` before any `send()` or listener attachment. If using `new WebSocket(url)`: do NOT call `accept()`, but ensure `send()` is only called inside the `open` event handler, not synchronously at construction time.

4. **Prefer `fetch()` + Upgrade for Vertex AI.** The `Authorization: Bearer {token}` header must be set at WebSocket handshake time. `new WebSocket(url)` header support is runtime-version dependent; `fetch()` + Upgrade is the stable, documented approach.

5. **Accept the memory-pinning cost.** Outbound WebSockets cannot hibernate. Budget for the DO being alive for the full interview session duration (~20-30 min). This is the expected Cloudflare behavior, not a bug.

---

## Open questions / gaps

- **`gemini-2.0-flash-live-preview-04-09` vs `gemini-live-2.5-flash-native-audio`:** The reference docs still show the older `-04-09` model ID in some code examples. It's unclear whether this has been quietly removed or is still live. If the GA model isn't working, try `-04-09` in `us-central1` as a fallback — but do not build on it long-term.
- **Auth header delivery with `new WebSocket()` third-argument extension:** Cloudflare Workers support a non-standard third argument to `new WebSocket(url, protocols, { headers })`. Whether this is available in the current `workerd` version deployed on your account is not confirmed in this research. The `fetch()` + Upgrade pattern sidesteps this uncertainty.
- **`global` region for `gemini-live-2.5-flash-native-audio`:** The community thread mentions region specificity for 2.0 models. Whether the 2.5 GA model is available globally (not just `us-central1`) is not confirmed in the sources found. Use `us-central1` until confirmed otherwise.

---

## Sources

1. [Gemini flash Live API docs chaos sorted out (Google AI Developers Forum)](https://discuss.ai.google.dev/t/gemini-flash-live-api-docs-chaos-sorted-out/80120) — Community thread, 2025
2. [Gemini Live API overview — Generative AI on Vertex AI (Google Cloud Docs)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api) — Official docs, 2025
3. [Gemini 2.5 Flash with Gemini Live API — Google Cloud Docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api) — Official docs, 2025
4. [Start and manage live sessions — Google Cloud Docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/start-manage-session) — Official docs, 2025
5. [GoogleCloudPlatform/generative-ai — intro_multimodal_live_api.ipynb (GitHub)](https://github.com/GoogleCloudPlatform/generative-ai/blob/main/gemini/multimodal-live-api/intro_multimodal_live_api.ipynb) — Official code sample, 2025
6. [Gemini Live API reference — Google Cloud Docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live) — Official docs, 2025
7. [How to use Gemini Live API Native Audio in Vertex AI (Google Cloud Blog)](https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai) — Vendor blog, 2025
8. [WebSockets runtime API — Cloudflare Workers Docs](https://developers.cloudflare.com/workers/runtime-apis/websockets/) — Official docs, 2025
9. [Using the WebSockets API — Cloudflare Workers Examples](https://developers.cloudflare.com/workers/examples/websockets/) — Official docs, 2025
10. [Use WebSockets — Cloudflare Durable Objects Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — Official docs, 2025
11. [Feature Request: Add hibernation support for outgoing WebSocket connections — cloudflare/workerd #4864 (GitHub)](https://github.com/cloudflare/workerd/issues/4864) — Engineering issue, 2024
