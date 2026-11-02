# Double-iframe sandbox

The sandbox proxy that isolates untrusted web content for the frame components of the iframe catalog (`WebAppFrameUrl`, `WebAppFrameSrcdoc`) and the MCP catalog (`McpApp`), and the host-side helpers the bridges of both catalogs are built on.

The MCP Apps specification requires web hosts to wrap the view in a sandbox proxy and recommends serving that proxy from a dedicated origin. This directory implements that proxy once for both catalog packages. The outer frame is the proxy page, embedded without a `sandbox` attribute because it checks who embeds it (`document.referrer`) and exchanges messages with the host by origin. The inner frame holds the untrusted content, with `sandbox` flags that exclude `allow-same-origin`, and the proxy relays messages between the host and that inner frame. The [web app frame specification](../../../../catalogs/iframe/web_app_frame_specification.md) and the [MCP App specification](../../../../catalogs/mcp/v1/mcp_app_specification.md) define the controls.

By default the proxy is served from the host's own origin (`/a2ui-sandbox/`). That is convenient but gives no origin isolation beyond the sandboxed inner frame itself and disables the proxy's cross-origin self-test. Production hosts should serve the proxy from a dedicated origin by pointing `configureSandbox({baseUrl})` at it and listing the host origin in the proxy page's `a2ui-sandbox-host-origins` meta tag. Even when same-origin, the proxy still gives the content a controlled embedding document: `srcdoc` documents inherit the embedding document's CSP, so the proxy page sets only `object-src 'none'` and leaves `script-src`, `style-src` and the rest to the CSP `<meta>` the proxy injects into every inline document. Author CSP tags are kept, so the effective policy is the intersection of the proxy page's, the injected one and the author's; an author tag can narrow the policy but never widen it. The proxy also keeps a single code path regardless of where it is served.

## The proxy

| File                               | Role                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox.html`, `sandbox-url.html` | The proxy pages: `sandbox.html` for inline HTML content (its CSP only forbids plugins, because `srcdoc` inherits it and the proxy injects the inner document's policy as a CSP `<meta>`) and `sandbox-url.html` for an external URL (its CSP allows the inner frame to load any `http(s)`, `blob:` or `data:` URL). |
| `sandbox.ts`                       | The proxy logic: origin and referrer checks, permissions policy merge, top navigation blocking, sandbox flags and CSP of the inner frame, the ready notifications of both protocols and the `disable_security_self_test` parameter.                                                                                 |
| `sandbox_main.ts`                  | Entry point of the proxy bundle; calls `startSandboxProxy` with the real `window`.                                                                                                                                                                                                                                  |

Each package bundles `sandbox_main.ts` with esbuild (`scripts/build-sandbox.mjs`) and ships the result with the two pages in `dist/sandbox/`. The host application serves that directory, at `/a2ui-sandbox/` by default.

## Host-side helpers

| File                              | Role                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frame_host.ts`                   | `FrameHost`: what a bridge needs from the component that renders the frame (data paths, catalog functions, actions).                                                |
| `sandbox_config.ts`               | Where the host serves the proxy pages: `configureSandbox`, `resolveSandboxUrl`.                                                                                     |
| `sandbox_bootstrap.ts`            | Host side of the proxy handshake: proxy-ready in, resource-ready out, with source window and origin checks.                                                         |
| `payload_validation.ts`           | Structural limits of every payload that crosses the frame boundary: prototype pollution keys, nesting depth, serialized size.                                       |
| `data_model_sync.ts`              | Two-way sync of the `data.paths` bindings between the surface data model and the frame, with echo suppression.                                                      |
| `frame_sizing.ts`                 | Clamped and throttled resize requests from the app, and the container dimensions reported back to it.                                                               |
| `sandboxed_frame_element.ts`      | Base class of the frame components: renders the proxy frame, applies `height`, runs the handshake and owns the bridge lifecycle across context and content changes. |
| `component_context_frame_host.ts` | `ComponentContextFrameHost`: the `FrameHost` over a universal component's `ComponentContext`.                                                                       |
| `testing/fake_frame_host.ts`      | `FakeFrameHost` for bridge tests.                                                                                                                                   |

Tests (`*.test.ts`) sit next to each file and run in the Karma suite of every package that copies this directory.
