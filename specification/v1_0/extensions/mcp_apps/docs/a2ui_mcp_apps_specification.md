# SEP-XXXX: A2UI over MCP Apps Protocol Extension (v1.0)

**Status:** Draft

**Created:** 2026-08-18

## Abstract

This extension delivers A2UI (Agent-to-User Interface) v1.0 interfaces over MCP and MCP Apps (SEP-1865). Servers emit one capability-independent wire format: every UI-producing tool result embeds the A2UI message stream as an `application/a2ui+json` resource, and every UI-producing tool links — via the standard SEP-1865 `_meta.ui.resourceUri` — to a predeclared HTML **renderer bundle** embedding an A2UI web renderer.

Hosts with native A2UI rendering consume the JSON messages directly, with no iframe overhead and full host styling. Hosts that only implement SEP-1865 — including legacy hosts with no A2UI knowledge — render the bundle in the standard sandboxed iframe; the bundle receives the unmodified tool result through `ui/notifications/tool-result` and renders the same messages. Text-only hosts fall back to any other content blocks the server includes. One server code path serves all hosts.

## Motivation

MCP Apps (SEP-1865) standardized UI delivery via `ui://` resources and sandboxed iframes. For hosts that render A2UI natively (web components, Angular, Android, iOS, Flutter), the iframe adds overhead, limits visual integration, and complicates event dispatch.

An A2UI extension must not fragment the ecosystem: a server adopting A2UI must keep working, unchanged, on every SEP-1865 host.

This revision uses a **single-payload, dual-render** architecture with three goals:

- **Zero-modification legacy support.** Every SEP-1865 host renders A2UI-backed apps unchanged; all A2UI awareness lives in a server-provided renderer bundle that is an ordinary MCP App.
- **Single server code path.** Servers produce one payload shape regardless of client capabilities. Capability inspection is an optimization (catalog selection, tool registration), not a requirement.
- **Native rendering where available.** Hosts advertising A2UI support consume `application/a2ui+json` directly, bypassing the iframe while keeping host styling, accessibility, and zero-latency event dispatch.

## Terminology

- **Host** — the MCP client application embedding the agent experience (per SEP-1865).
- **View** — a UI instance rendered by the host for a server (per SEP-1865). In this extension a View is either a set of native A2UI surfaces or an iframe running the renderer bundle.
- **Renderer bundle** — a self-contained `text/html;profile=mcp-app` resource that embeds an A2UI web renderer plus one or more component catalogs, along with MCP Apps glue code.
- **Native renderer** — a host-integrated A2UI renderer.
- **Surface** — an A2UI surface as defined by the A2UI v1.0 specification.

## Specification

### Extension Identifiers and Reserved Names

- **Extension URI:** `https://a2ui.org/mcp-apps-extension/a2ui/v1.0`
- **A2UI capability identifier** (key under `capabilities.extensions`, for both clients and servers): `org.a2ui/ui`
- **MCP Apps capability identifier** (defined and owned by SEP-1865; reused, not modified, by this extension): `io.modelcontextprotocol/ui`
- **Native A2UI MIME type:** `application/a2ui+json`
- **MCP App HTML MIME type:** `text/html;profile=mcp-app`
- **Reserved `_meta` key:** `org.a2ui/ui` (object). All A2UI-specific metadata travels under this single namespaced key. This extension MUST NOT add fields inside the `_meta.ui` namespace, which is owned by SEP-1865.

### Architecture Overview

Single payload, three render paths:

```
                              one CallToolResult
        +-----------------------------------------------------------+
        |  content: [                                               |
        |    { type: "text", text: "..." },  (optional)   <---------+-- model / text-only hosts
        |    { type: "resource", resource: {                        |
        |        mimeType: "application/a2ui+json",       <---------+-- native hosts AND renderer bundle
        |        text: "[ createSurface, updateDataModel, ... ]"    |
        |    }}                                                     |
        |  ]                                                        |
        +-----------------------------------------------------------+

 tool._meta.ui.resourceUri ---> ui://server/a2ui-renderer.html   <--- legacy SEP-1865 hosts load this
                                (the bundle extracts the same a2ui+json
                                 messages from ui/notifications/tool-result)
```

1. The server predeclares one **renderer bundle** resource (`ui://…`, `text/html;profile=mcp-app`).
2. Every UI-producing tool references the bundle via the standard `_meta.ui.resourceUri`.
3. Every UI-producing tool result contains one embedded `application/a2ui+json` resource holding an ordered array of A2UI agent-to-renderer messages, and MAY contain other content blocks (e.g., text for model context and text-only hosts).
4. **Native path:** a host that negotiated `application/a2ui+json` reads the embedded resource and feeds the messages to its native renderer. No iframe.
5. **Iframe path:** any SEP-1865 host follows the standard lifecycle unmodified: it renders the bundle in the sandboxed iframe and forwards the complete tool result via `ui/notifications/tool-result`. The bundle extracts the same messages and renders them.
6. **Text path:** hosts without UI support display any text content the server included.

The payload is identical in all cases, so servers need no capability branching:

```typescript
// Server side: one code path, no capability branching
function counterToolResult(count: number): CallToolResult {
  const messages = [
    {
      version: "v1.0",
      createSurface: {
        surfaceId: "counter",
        catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
        components: [/* ... */],
        dataModel: { count },
      },
    },
  ];
  return {
    content: [
      { type: "text", text: `Counter is at ${count}.` },
      {
        type: "resource",
        resource: {
          uri: "ui://counter-server/views/counter.a2ui",
          mimeType: "application/a2ui+json",
          text: JSON.stringify(messages),
        },
      },
    ],
  };
}
```

### Capability Negotiation (`initialize`)

#### Client capabilities

A client declares UI support in two places under `capabilities.extensions`:

1. `application/a2ui+json` joins the SEP-1865 `mimeTypes` array — an additive use of the existing mechanism; legacy servers ignore unknown entries.
2. A2UI details (protocol versions, supported catalogs) live under this extension's key, `org.a2ui/ui`. `rendererCapabilities` conforms to A2UI's `renderer_capabilities.json`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": { "name": "a2ui-host-client", "version": "1.0.0" },
    "capabilities": {
      "extensions": {
        "io.modelcontextprotocol/ui": {
          "mimeTypes": [
            "text/html;profile=mcp-app",
            "application/a2ui+json"
          ]
        },
        "org.a2ui/ui": {
          "rendererCapabilities": {
            "v1.0": {
              "supportedCatalogIds": [
                "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
              ]
            }
          }
        }
      }
    }
  }
}
```

Clients MUST declare `org.a2ui/ui` and the `application/a2ui+json` MIME type together or not at all (native rendering requires known catalogs); both present means native A2UI support. A native-only host omits `text/html;profile=mcp-app` from `mimeTypes`.

#### Server capabilities

Servers that emit A2UI declare agent-side capabilities in the `initialize` result:

```json
{
  "capabilities": {
    "extensions": {
      "org.a2ui/ui": {
        "agentCapabilities": {
          "v1.0": {
            "supportedCatalogIds": [
              "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ],
            "acceptsInlineCatalogs": false
          }
        }
      }
    }
  }
}
```

- `agentCapabilities` conforms to A2UI's `agent_capabilities.json`.

#### Per-request capabilities (stateless servers)

If the server cannot retain session state, the client MAY repeat renderer capabilities on each call under the reserved `_meta` key:

```json
{
  "jsonrpc": "2.0",
  "id": "id-123",
  "method": "tools/call",
  "params": {
    "name": "generate_report",
    "arguments": { "date": "2026-03-01" },
    "_meta": {
      "org.a2ui/ui": {
        "rendererCapabilities": {
          "v1.0": {
            "supportedCatalogIds": [
              "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
            ]
          }
        }
      }
    }
  }
}
```

Session-level declaration is RECOMMENDED; per-request metadata is the stateless fallback.

#### How capabilities are used

The wire format is capability-independent, so negotiation affects only:

- **Servers** SHOULD use capabilities as SEP-1865 recommends (e.g., the `getUiCapability` pattern): to decide whether to register UI-enabled tools, and to pick catalogs the client supports natively. A server MAY ignore capabilities and always emit the single payload; legacy and text-only behavior still degrades correctly.
- **Hosts advertising `application/a2ui+json`** render natively whenever they support every catalog a payload resolves against.
- **Hosts advertising both MIME types** MUST fall back to the iframe path for any payload whose catalogs they cannot satisfy natively. The bundle ships its own catalogs, so the fallback always renders.
- **Hosts advertising only `text/html;profile=mcp-app`** — every existing SEP-1865 host — need no knowledge of this extension.

### Resources

#### The renderer bundle (required)

The renderer bundle is the legacy-compatibility surface and MUST be predeclared by every server exposing UI-producing tools.

Requirements:

- URI MUST use the `ui://` scheme; `mimeType` MUST be `text/html;profile=mcp-app`; content MUST be a valid HTML5 document (all per SEP-1865).
- The bundle MUST be self-contained (renderer, catalogs, glue code inlined) **or** load assets only from absolute URLs on origins declared in `_meta.ui.csp.resourceDomains`. Relative references (e.g., `<script src="app.js">`) do not resolve in the SEP-1865 sandbox and MUST NOT be used.
- The bundle SHOULD declare no `connectDomains`: all data flows over the MCP `postMessage` channel, so it needs no direct network access.

Resource registration:

```json
{
  "uri": "ui://counter-server/a2ui-renderer.html",
  "name": "a2ui_renderer",
  "description": "A2UI renderer bundle (iframe path)",
  "mimeType": "text/html;profile=mcp-app"
}
```

`resources/read` result:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "ui://counter-server/a2ui-renderer.html",
        "mimeType": "text/html;profile=mcp-app",
        "text": "<!DOCTYPE html><html><head><script type=\"module\">/* inlined: A2UI web renderer + basic catalog + MCP Apps glue */</script></head><body><div id=\"a2ui-root\"></div></body></html>",
        "_meta": {
          "ui": {
            "prefersBorder": false,
            "csp": { "connectDomains": [], "resourceDomains": [] }
          }
        }
      }
    ]
  }
}
```

**Bundle contract.** The bundle is a standard MCP App and MUST follow the SEP-1865 View lifecycle. In addition it:

1. Performs the `ui/initialize` → `ui/notifications/initialized` handshake, declaring `appCapabilities` (e.g., `availableDisplayModes`).
2. SHOULD map `hostContext.styles.variables` (and `theme`) onto the renderer's theme tokens so surfaces match the host visually.
3. On `ui/notifications/tool-result` (and optionally `tool-input` / `tool-input-partial` for loading states), extracts A2UI messages per the algorithm below and feeds them, in order, to the renderer.
4. Dispatches user actions and function calls to the server as `tools/call` over the postMessage MCP channel, per *Renderer-to-Agent Channel* — the same mapping native hosts use.
5. Emits `ui/notifications/size-changed` as surfaces grow or shrink.
6. On `ui/notifications/tool-cancelled` and `ui/resource-teardown`, tears down all surfaces (equivalent to `deleteSurface` for each) before responding.

**Message extraction algorithm** (used identically by bundles and native hosts):

```
for item in callToolResult.content:
  if item.type == "resource"
     and item.resource.mimeType == "application/a2ui+json":
    payload  = parse JSON from item.resource.text
               (or base64-decode item.resource.blob)
    messages = payload if payload is an array else [payload]
    process messages in order
ignore every other content item
```

Consumers MUST ignore content items with unrecognized MIME types rather than erroring.

**Generic bundles.** SEP-1865 exposes the invoking tool (with `_meta`) in `hostContext.toolInfo.tool`, so one bundle can serve every tool — even across servers: it reads `toolInfo.tool._meta["org.a2ui/ui"].resourceUri` (if present) to prefetch the view template via `resources/read`, then applies tool-result messages as they arrive. Servers MAY instead bake templates into per-app bundles.

#### Optional predeclared A2UI view templates

A server MAY predeclare the static portion of a view (typically `createSurface` and `updateComponents` template messages) as its own resource:

- URI MUST use the `ui://` scheme; `mimeType` MUST be `application/a2ui+json`. SEP-1865 reserves non-HTML MIME types on `ui://` resources for extensions such as this one.
- Content is a JSON array of agent-to-renderer messages (or a single message object).
- Linked from tools via `_meta["org.a2ui/ui"].resourceUri` — never via `_meta.ui.resourceUri`, which legacy hosts would attempt to render as HTML.
- Native hosts and bundles MAY prefetch and cache it (mirroring SEP-1865's template/data separation); tool results then carry only data updates (`updateDataModel`, incremental `updateComponents`).
- Like other UI resources, servers MAY omit these from `resources/list`.

Predeclared templates are an optimization; without them, tool results carry the full message stream.

#### A2UI via `resources/read` and resource templates

Tool results are not the only delivery channel. Any `ui://` resource with `mimeType: "application/a2ui+json"` is a valid message carrier, and servers MAY expose A2UI views through standard MCP resource mechanisms:

- **Plain resources** — declared in (or omitted from) `resources/list`, fetched with `resources/read`, like the predeclared templates above. Suits static or slowly-changing views.
- **Resource templates** — declared via `resources/templates/list` with an RFC 6570 URI template (e.g., `ui://report-server/views/report/{reportId}.a2ui`). The consumer expands parameters and reads the resulting URI; the server renders that instance's message array on demand. Suits parameterized views without a tool call per variant.

Rules for both:

- Embedded-payload MIME, schema, and processing rules apply: content is a single agent-to-renderer message or ordered array conforming to `agent_to_renderer.json`, processed in order.
- `_meta["org.a2ui/ui"].resourceUri` MAY carry an expanded template URI, pointing native hosts and generic bundles at a per-instance view.
- Surface identity and ordering rules (see *Tool Results*) apply regardless of delivery channel.
- Servers MAY mark these resources subscribable; `notifications/resources/updated` then signals consumers to re-read (see *Streaming and Progressive Rendering*).
- Resource delivery is pull-only and carries no `_meta`; interactions still flow over the *Renderer-to-Agent Channel*, and tool results remain the only channel synchronized with an invocation.

> **Design note — why `ui://` and not `a2ui://`?** SEP-1865's resource pipeline — tool→resource linkage, discovery, prefetching, CSP metadata — is defined over `ui://`; resources on any other scheme are invisible to it. What distinguishes an A2UI template from an HTML bundle is its content type, and MIME is the typing system MCP resources already use — SEP-1865 reserves non-HTML MIME types on `ui://` resources for exactly this. A parallel scheme would duplicate the MIME signal while opting out of the sanctioned mechanism. See *Rationale*, item 2.

### Tool Declaration

```json
{
  "name": "get_counter",
  "description": "Show an interactive counter",
  "inputSchema": { "type": "object" },
  "_meta": {
    "ui": {
      "resourceUri": "ui://counter-server/a2ui-renderer.html",
      "visibility": ["model", "app"]
    },
    "org.a2ui/ui": {
      "resourceUri": "ui://counter-server/views/counter.a2ui"
    }
  }
}
```

- `_meta.ui.resourceUri` MUST point at the renderer bundle (HTML). Pointing it at an `application/a2ui+json` resource breaks legacy hosts and is forbidden.
- `_meta["org.a2ui/ui"].resourceUri` (optional) points at the predeclared A2UI template.
- SEP-1865 `visibility` semantics apply unchanged and govern surface-initiated calls (see *Renderer-to-Agent Channel*).
- Both referenced resources MUST exist on the server.

### Tool Results

Requirements for a UI-producing `CallToolResult`:

1. It MUST include exactly one embedded resource with `mimeType: "application/a2ui+json"` whose `text` (or base64 `blob`) is a single agent-to-renderer message or ordered array, each conforming to A2UI v1.0 `agent_to_renderer.json` (every message carries `"version": "v1.0"`).
2. It MAY include other content blocks. Servers SHOULD consider a `text` block as the model-facing representation and text-only fallback, but it is not required.
3. The embedded resource's `uri` SHOULD be stable per view (e.g., the template URI) so hosts can correlate results.
4. Messages MAY create, update, or delete multiple surfaces in one result.

Example — identical for every host:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "Counter is at 42." },
      {
        "type": "resource",
        "resource": {
          "uri": "ui://counter-server/views/counter.a2ui",
          "mimeType": "application/a2ui+json",
          "text": "[{\"version\":\"v1.0\",\"createSurface\":{\"surfaceId\":\"counter\",\"catalogId\":\"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json\",\"components\":[{\"id\":\"root\",\"component\":\"Column\",\"children\":[\"title\",\"count_text\",\"btn_inc\"]},{\"id\":\"title\",\"component\":\"Text\",\"text\":\"MCP Interactive Counter\"},{\"id\":\"count_text\",\"component\":\"Text\",\"text\":{\"call\":\"formatString\",\"args\":{\"value\":\"Current count: ${/count}\"}}},{\"id\":\"btn_inc_label\",\"component\":\"Text\",\"text\":\"Increment\"},{\"id\":\"btn_inc\",\"component\":\"Button\",\"child\":\"btn_inc_label\",\"action\":{\"event\":{\"name\":\"increment_counter\",\"context\":{\"step\":1}}}}],\"dataModel\":{\"count\":42}}}]"
        }
      }
    ]
  }
}
```

**Ordering and surface identity:**

- Within a payload, messages MUST be processed in array order.
- Across results, ordering follows JSON-RPC response order within the session.
- `surfaceId` rules follow A2UI v1.0: IDs are unique per renderer lifetime; later results MAY target surfaces created earlier in the same lifetime; recreating an existing ID without `deleteSurface` is an error.
- Renderer lifetime: iframe mode, the View instance; native mode, host-defined but at least the creating MCP session. Servers MUST NOT assume surfaces persist across sessions.

**Model-context hygiene:**

- Hosts aware of this extension SHOULD NOT place `application/a2ui+json` text into model context; the text block, when present, is the model-facing representation (per SEP-1865's split between model-facing `content` and UI-facing payloads).
- Legacy hosts may forward content blindly, so servers SHOULD keep payloads compact and put large static component trees in predeclared templates.

**Host forwarding.** In iframe mode, hosts MUST deliver the complete `CallToolResult` — including `application/a2ui+json` resources — in `ui/notifications/tool-result`, as SEP-1865 requires (`params: CallToolResult`), and MUST NOT strip unrecognized content items.

> **Design note — why an embedded resource, not `structuredContent` or `_meta`?** An embedded resource is MIME-typed (detected without out-of-band convention), symmetric with the predeclared-template representation, and independent of tool `outputSchema`. `structuredContent` stays free for model-visible structured data.

### Rendering Paths

#### Native path (host-integrated renderer)

1. The host routes each message to a native surface by `surfaceId`, per A2UI v1.0, rendering with full host styling and accessibility.
2. The host MUST render only through its certified catalogs and MUST NOT execute JavaScript, HTML, or CSS from payloads. All payload values, including `Dynamic*` bindings and `formatString` output, are data, never code.
3. Catalog resolution follows A2UI v1.0 (component-level `catalogId` → surface default `catalogId` → resolution error). If a payload resolves to a catalog the host cannot satisfy:
   - Hosts that also advertise `text/html;profile=mcp-app` MUST fall back to the iframe path (renderer bundle) for that view.
   - Native-only hosts MUST display the result's non-A2UI content blocks, if any, and SHOULD return an A2UI `error` envelope via the renderer-to-agent channel.
4. Teardown: the host MAY delete surfaces when the conversation or session ends. Native mode has no `ui/resource-teardown`; hosts SHOULD apply an equivalent policy.

#### Iframe path (every SEP-1865 host, unchanged)

The host follows SEP-1865 to the letter — sandbox proxy, CSP from resource metadata, lifecycle notifications, display modes, dimensions, theming. All A2UI awareness lives in the bundle. A legacy host cannot distinguish an A2UI-backed app from any other MCP App; that is the compatibility guarantee.

### Renderer-to-Agent Channel

All renderer-to-agent traffic is ordinary MCP. The mappings are identical in native and iframe modes; in iframe mode, calls travel over the SEP-1865 postMessage transport, proxied by the host to the server.

#### User actions → `tools/call`

When a component's `action.event` fires:

- `params.name` = the A2UI event name.
- `params.arguments` = the event's resolved `context` object.
- `params._meta["org.a2ui/ui"].surfaceId` = the originating surface — the only action metadata carried. It disambiguates when multiple live surfaces can invoke the same tool, and cannot go in `arguments` without polluting the model-visible `inputSchema`. The other A2UI action-envelope fields (`sourceComponentId`, `timestamp`) are dropped: JSON-RPC ordering covers sequencing, and authors needing a component discriminator can put one in `context`.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "increment_counter",
    "arguments": { "step": 1 },
    "_meta": {
      "org.a2ui/ui": {
        "surfaceId": "counter",
        "dataModel": {
          "version": "v1.0",
          "surfaces": { "counter": { "count": 42 } }
        }
      }
    }
  }
}
```

Rules:

- Surface-initiated calls are **app-scoped** under SEP-1865 `visibility`: the target tool MUST include `"app"` in `_meta.ui.visibility` (the default `["model", "app"]` qualifies); hosts MUST reject calls to tools without it. Servers SHOULD declare pure UI interactions `visibility: ["app"]` to keep them out of the model's tool list.
- Event names and tools come from the same server, so alignment is by construction. Servers MUST expose a tool for every `event.name` they emit.
- If the call fails (unknown tool, host rejection, tool error), the renderer MUST contain the failure locally (error boundary or notification) per A2UI's action-pipeline rules; it MUST NOT tear down the surface.
- The result is processed like any tool result: extract the `application/a2ui+json` payload and apply its messages (`updateDataModel`, `updateComponents`, etc.). `agentFunctionResponse` correlates only to `callAgentFunction`; it is not the response type for user actions.

#### Data model synchronization (`sendDataModel`)

On every renderer-to-agent request, if any surface owned by this server connection was created with `sendDataModel: true`, the sender MUST attach current data models under `_meta["org.a2ui/ui"].dataModel`, conforming to A2UI's `renderer_data_model.json`:

```json
{ "version": "v1.0", "surfaces": { "<surfaceId>": { } } }
```

This applies to action-dispatched `tools/call`, `callAgentFunction`-mapped calls, and (in iframe mode) `ui/message` requests triggered from a surface.

This — not `ui/update-model-context` — is the A2UI synchronization mechanism: the data model must reach the **server** that owns the surface, atomically with the interaction. `ui/update-model-context` targets the **host's model context** and may be deferred until the next user message, so it can neither reach the server nor guarantee timing.

Optionally, to keep the host's model informed of UI state:

- In iframe mode, the bundle MAY additionally issue `ui/update-model-context` with a model-facing summary of the state.
- In native mode, hosts MAY inject equivalent context themselves.

Per A2UI targeted delivery, data models go only to the server connection that created the surface.

#### Renderer-initiated functions (`callAgentFunction`) → `tools/call`

A2UI's fallback routing sends renderer-unresolved functions to the agent. Here they route to the tool of the same name:

- `params.name` = the function name; `params.arguments` = the function `args`.
- `params._meta["org.a2ui/ui"].functionCall` = `{ "functionCallId": "...", "surfaceId": "...", "catalogId": "..." }`.
- The server includes an `agentFunctionResponse` message (matching `functionCallId`) in the result's `application/a2ui+json` payload; the renderer resolves the pending binding with its `value` or `error`.
- On a JSON-RPC error (e.g., unknown tool), the renderer synthesizes a local failure equivalent to `agentFunctionResponse.error` with `code: "UNKNOWN_FUNCTION"`.
- App-visibility rules apply as for user actions.

#### Agent-initiated functions (`callRendererFunction`): unsupported

This binding does not support `callRendererFunction`: MCP gives servers no server→client request channel, and the message could only arrive inside a tool result — after the renderer has already called the server, when the result's ordinary messages suffice. Servers MUST NOT emit `callRendererFunction`; a renderer that receives one MUST drop it unexecuted (logging locally). Renderer-initiated functions (`callAgentFunction` / `agentFunctionResponse`) are unaffected. A dedicated response channel is deferred (see *Open Questions*).

`_meta["org.a2ui/ui"].messages` is the general carrier for renderer-to-agent envelopes: renderers MAY piggyback pending envelopes (e.g., validation `error` messages) on any request to the same server, each conforming to `renderer_to_agent.json`.

#### Host functions

This extension defines a host-integration catalog, `catalogId: "https://a2ui.org/specification/v1_0/extensions/mcp_apps/catalogs/host/catalog.json"`, that renderers in MCP Apps contexts SHOULD support:

- **`sendMessageToAgent(text)`** — inserts a user-role message into the host conversation. Iframe mode: the bundle issues SEP-1865 `ui/message`. Native mode: the host inserts it directly under the same policy. Hosts MAY require user consent, as SEP-1865 allows for `ui/message`.

Catalog function definition:

```json
{
  "sendMessageToAgent": {
    "type": "object",
    "description": "Sends a message to the host's chat interface (SEP-1865 ui/message).",
    "returnType": "void",
    "callableFrom": "rendererOnly",
    "properties": {
      "call": { "const": "sendMessageToAgent" },
      "args": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "description": "The text content of the message."
          }
        },
        "required": ["text"],
        "additionalProperties": false
      }
    },
    "required": ["call", "args"],
    "unevaluatedProperties": false
  }
}
```

Resulting `ui/message` request (iframe mode):

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "ui/message",
  "params": {
    "role": "user",
    "content": { "type": "text", "text": "The text provided by the component." }
  }
}
```

When the basic catalog's **`openUrl`** executes in iframe mode, the bundle MUST route it through SEP-1865 `ui/open-link` (subject to the host's `openLinks` capability), never navigating directly. Native hosts apply their own link policy; the catalog's user-activation requirement applies in both modes.

### Streaming and Progressive Rendering

- Tool-result delivery is atomic in MCP, so a single result cannot render time-progressively; ordered processing still yields deterministic intermediate states.
- Progressive experiences span turns: successive tool calls (including surface-invoked refresh tools) target the same `surfaceId` with incremental `updateComponents` and `updateDataModel` messages.
- Predeclared templates let hosts render structure while the first tool call is in flight; `ui/notifications/tool-input` and `tool-input-partial` can drive loading states in the bundle.
- Servers MAY mark template resources subscribable; `notifications/resources/updated` then prompts a re-read — a coarse push channel. Fine-grained streaming over MCP progress notifications is deferred to a future revision.

### Security and Sandboxing

#### Architecture

```
+--------------------------------------------------------------------------+
| Host Application                                                         |
|                                                                          |
|  [ Native path ]                                                         |
|    <a2ui-surface>  <-- application/a2ui+json messages (from tool result) |
|        | actions / functions / dataModel (_meta "org.a2ui/ui")           |
|        v                                                                 |
|    MCP client ------------------------------ tools/call --------------+  |
|                                                                       |  |
|  [ Iframe path (SEP-1865, unchanged) ]                                |  |
|    <iframe sandbox_proxy>                                             |  |
|      <iframe sandbox srcdoc="renderer bundle">                        |  |
|         embedded A2UI renderer <-- same a2ui+json messages            |  |
|         postMessage JSON-RPC (ui/*, tools/call) --> Host proxy -------+  |
+-----------------------------------------------------------------------|--+
                                                                        |
                                                                 MCP transport
                                                                        |
+--------------------------------------------------------------------------+
| MCP Server -- single code path                                           |
|   CallToolResult = text + EmbeddedResource(application/a2ui+json)        |
|   _meta.ui.resourceUri -> ui://... renderer bundle (text/html;mcp-app)   |
+--------------------------------------------------------------------------+
```

#### Rules

1. **Native mode.** Hosts MUST render only via certified catalogs and MUST NOT execute JavaScript or untrusted HTML/CSS from payloads. All payload values are data.
2. **Iframe mode.** SEP-1865 sandboxing applies unchanged: double-iframe sandbox on web hosts, strict `sandbox` flags (no `allow-same-origin` on inner frames, no `allow-top-navigation`), CSP from declared resource metadata with restrictive defaults. The bundle is untrusted server content like any MCP App.
3. **Consent parity.** Surface-initiated `tools/call` (actions and functions) MUST follow the same host policy as app-initiated calls under SEP-1865 — hosts MAY block or require approval, and SHOULD for side-effecting tools. Native rendering grants no approval bypass.
4. **Provenance in native mode.** Without an iframe boundary, server-authored UI renders in host chrome, raising spoofing risk. Hosts SHOULD visually attribute surfaces to their server and prevent them imitating host system UI (settings dialogs, credential prompts, permission sheets).
5. **Data model privacy.** `sendDataModel` ships full surface state — potentially including user-typed input — to the owning server on every interaction. Delivery is targeted to that server only; hosts MAY redact or deny synchronization per policy.
6. **Model-context hygiene.** Keeping `application/a2ui+json` out of model context (see *Tool Results*) bounds token cost and the prompt-injection surface reachable through UI payloads.
7. **Auditability.** All renderer-to-agent traffic is ordinary JSON-RPC (`tools/call`, `ui/*`) and inherits SEP-1865's validation and logging guidance.

### Backward Compatibility

- **Legacy SEP-1865 hosts (no A2UI knowledge):** see only conformant constructs — a predeclared `ui://` HTML resource, `_meta.ui.resourceUri`, standard lifecycle and notifications. Unknown `_meta` keys (`org.a2ui/ui`) and unknown MIME types are ignored per MCP rules. The bundle handles all A2UI logic; no host changes required.
- **Text-only hosts:** display whatever non-A2UI content the server includes (servers SHOULD consider a text block for this audience).
- **Native hosts:** opt in via capabilities and skip the iframe entirely.
- **Servers:** one payload for all hosts; capability inspection is an optimization, not a requirement.
- **A2UI ecosystems:** wire messages are unmodified A2UI v1.0; existing renderer SDKs and validators consume them directly.

## Rationale (key design decisions)

1. **Single payload over server-side branching.** Earlier drafts had servers inspect capabilities and emit either raw A2UI or an HTML bundle. That doubles server logic, and the fallback (embedded HTML in tool results) is a pattern SEP-1865 rejected in favor of predeclared resources — compliant hosts would not render it. A predeclared renderer bundle plus capability-independent results restores legacy compatibility and removes the branch.
2. **`ui://` only.** A parallel `a2ui://` scheme is invisible to SEP-1865's tool→resource linkage and discovery. SEP-1865 reserves non-HTML MIME types on `ui://` resources for future extensions — exactly the mechanism this extension uses for predeclared templates.
3. **Namespaced capabilities and metadata.** A root-level `capabilities.a2ui` key sits outside MCP's extension mechanism (SEP-1724), and a bare `a2ui` `_meta` key risks collisions. Everything lives under `org.a2ui/ui`; `application/a2ui+json` joins the `mimeTypes` array SEP-1865 defines for this purpose. Nothing is added inside SEP-1865-owned namespaces.
4. **`sendDataModel` via request `_meta`, not `ui/update-model-context`.** A2UI's transport contract requires the surface's owner (the server) to receive current state atomically with each interaction. `ui/update-model-context` addresses the host's model context, may be deferred, and never reaches the server — retained only as an optional mirror for model awareness.
5. **Embedded resource as the message carrier.** MIME-typed, symmetric with the predeclared-template representation, and independent of tool `outputSchema`; `structuredContent` stays free for model-visible structured data.
6. **No `callRendererFunction`.** MCP has no server→client push, so a response channel would require a dedicated server-declared tool — significant spec surface for a feature that, in a request/response transport, can only fire when the renderer has already called the server. Dropped from v1.0 rather than half-supported.

## Open Questions

- Incremental streaming of message arrays over MCP progress notifications, for progressive rendering within a single tool call.
- A return channel for agent-initiated renderer functions (`callRendererFunction`), should a compelling use case emerge.
- A registry of host-certified catalogs to improve native-mode interoperability.
- Whether SEP-1865 host-context changes (theme, display mode) need a native-mode analog surfaced to servers.
