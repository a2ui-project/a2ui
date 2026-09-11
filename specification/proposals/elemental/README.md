# A2UI Elemental developer guide

A2UI Elemental is a model-optimized declarative UI format that uses plain HTML5-like
custom-element markup (no custom JavaScript or CSS) as the inference format. A host-side
compiler parses this markup and compiles it into standard A2UI v1.0 wire protocol payloads.

This guide covers the standalone developer scripts in
`specification/proposals/elemental/scripts/` for compiling, decompiling, and generating
prompts from a catalog.

> **Note:** A2UI Elemental is `@experimental` and may change without notice. Unlike A2UI
> Express, it is **not** gated behind an environment variable — no `A2UI_*_ENABLED` flag is
> required.

---

## Prerequisites

The scripts load the experimental Elemental code from the repo source and resolve the rest
of the A2UI SDK (and its dependencies such as `google-adk` and `antlr4`) from the
`a2ui_agent` project. The simplest way to run them is with [`uv`](https://docs.astral.sh/uv/),
which provisions the project environment automatically:

```bash
cd specification/proposals/elemental
```

All commands below run from that directory and use
`uv run --project ../../../agent_sdks/python/a2ui_agent` so the correct environment is used
regardless of your global Python setup.

---

## CLI utility reference

### Prompt generation

Generate the model system prompt contract, containing the HTML5 markup rules and the
per-component TypeScript/TSX interface signatures compiled from the active catalog schema:

```bash
uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_prompt_generator.py \
  --catalog ../../v1_0/catalogs/basic/catalog.json
```

### Markup compiler (Elemental → A2UI JSON)

Compile an A2UI Elemental markup file (optionally wrapped in `<a2ui>` sentinels, i.e. the
shape a model emits) into standard, pretty-printed A2UI v1.0 JSON:

```bash
uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_compiler.py \
  path/to/sample.elemental \
  --surface-id "dashboard_surface"
```

`--surface-id` is optional: when provided it overrides the surface id, otherwise the id is
taken from the `<body>` element (falling back to `main` if absent).

### Decompiler (A2UI JSON → Elemental)

Convert a standard A2UI v1.0 JSON example (either a gallery example with a `messages`
array or a raw envelope) back into A2UI Elemental markup, wrapped in the `<a2ui>` sentinel:

```bash
uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_decompiler.py \
  ../../v1_0/catalogs/basic/examples/01_flight-status.json
```

---

## End-to-end round trip

Decompile a standard example to Elemental, then compile it back to verify fidelity:

```bash
uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_decompiler.py \
  ../../v1_0/catalogs/basic/examples/01_flight-status.json > /tmp/flight.elemental

uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_compiler.py \
  /tmp/flight.elemental
```

The decompiler emits the surface (components + data model) as `<a2ui>`-wrapped markup;
the compiler parses it back into a standard `createSurface` payload.
