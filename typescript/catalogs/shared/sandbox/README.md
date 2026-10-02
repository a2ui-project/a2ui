# Double-iframe sandbox

The sandbox proxy that isolates untrusted web content for the frame components of the iframe catalog (`WebAppFrameUrl`, `WebAppFrameSrcdoc`) and the MCP catalog (`McpApp`), and the host-side helpers the bridges of both catalogs are built on.

A frame component embeds a proxy page served from the host's own origin, without a `sandbox` attribute. The proxy creates the strictly sandboxed inner iframe the content runs in (`allow-scripts`, never `allow-same-origin`) and relays messages between the host and that inner frame. Keeping the untrusted content one level down avoids the `SecurityError` crashes that a sandboxed iframe placed directly in the host page causes in DevTools and browser extensions, while the inner frame stays isolated. The [web app frame specification](../../../../catalogs/iframe/web_app_frame_specification.md) defines the controls.

## The proxy

| File                               | Role                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox.html`, `sandbox-url.html` | The proxy pages: `sandbox.html` for inline HTML content (its CSP keeps the inner frame from loading external URLs) and `sandbox-url.html` for an external URL.                                                                      |
| `sandbox.ts`                       | The proxy logic: origin and referrer checks, permissions policy merge, top navigation blocking, sandbox flags and CSP of the inner frame, the ready notifications of both protocols and the `disable_security_self_test` parameter. |
| `sandbox_main.ts`                  | Entry point of the proxy bundle; calls `startSandboxProxy` with the real `window`.                                                                                                                                                  |

Each package bundles `sandbox_main.ts` with esbuild (`scripts/build-sandbox.mjs`) and ships the result with the two pages in `dist/sandbox/`. The host application serves that directory, at `/a2ui-sandbox/` by default.

## Host-side helpers

| File                         | Role                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `frame_host.ts`              | `FrameHost`: what a bridge needs from the component that renders the frame (data paths, catalog functions, actions). |
| `sandbox_config.ts`          | Where the host serves the proxy pages: `configureSandbox`, `resolveSandboxUrl`.                                      |
| `sandbox_bootstrap.ts`       | Host side of the proxy handshake: proxy-ready in, resource-ready out, with source window and origin checks.          |
| `security.ts`                | Checks on every payload that crosses the frame boundary: prototype pollution keys, nesting depth, serialized size.   |
| `data_model_sync.ts`         | Two-way sync of the `data.paths` bindings between the surface data model and the frame, with echo suppression.       |
| `frame_sizing.ts`            | Clamped and throttled resize requests from the app, and the container dimensions reported back to it.                |
| `testing/fake_frame_host.ts` | `FakeFrameHost` for bridge tests.                                                                                    |

Tests (`*.test.ts`) sit next to each file and run in the Karma suite of every package that copies this directory.
