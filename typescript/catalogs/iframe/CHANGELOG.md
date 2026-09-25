# Changelog

## Unreleased

- Add the `@a2ui/catalog-iframe` package: the sandbox proxy asset with its configuration
  (`configureSandbox`, `resolveSandboxUrl`), the `FrameHost` interface, the `a2ui_*` wire schemas and
  the `WebAppFrameBridge` host bridge with allowlist validation, data model sync, function calls and
  sizing. [#2797](https://github.com/a2ui-project/a2ui/pull/2797)
- Add `iframeCatalog` with the `WebAppFrameUrl` and `WebAppFrameSrcdoc` universal components, which
  render their content in the sandbox proxy and connect it to the surface through `WebAppFrameBridge`,
  plus `SandboxedFrameElement` and `ComponentContextFrameHost` for catalogs that add their own
  sandboxed frame components. `@a2ui/web_core` and `lit` become peer dependencies. [#2798](https://github.com/a2ui-project/a2ui/pull/2798)
