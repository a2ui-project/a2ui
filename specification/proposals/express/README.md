# A2UI Express developer guide

A2UI Express is a compact, token-efficient declarative syntax designed for dynamic generative user interfaces. It acts as an intermediate, highly compressed notation that local on-device or remote Gemini models generate. A host-side compiler parses this syntax and compiles it into standard A2UI v1.0 wire protocol payloads.

---

## Environment Variable Gate

To prevent pollution of the stable v1.0 baseline workspace during development, all A2UI Express code imports and command-line utilities are gated behind the environment variable `A2UI_EXPRESS_ENABLED`.

You **must** prepend `A2UI_EXPRESS_ENABLED=true` to all python command invocations.

---

## Compiling dynamic user interfaces

By default, the testing and evaluation tools are designed to run using remote Gemini models via the standard Google GenAI SDK.

### Running inference and validation (Gemini API)

To run inference and compiler validation using a standard remote Gemini model (e.g., `gemini-3.1-flash-lite`):

1. **Set your API Key**:

   ```bash
   export GEMINI_API_KEY="your_gemini_api_key_here"
   ```

2. **Navigate and Execute**:

   ```bash
   # Navigate to the express directory
   cd specification/proposals/express

   # Run inference against Gemini API (using the a2ui_agent project environment)
   A2UI_EXPRESS_ENABLED=true uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_inference.py \
     ../../v1_0/catalogs/basic/examples/01_flight-status.json \
     --model gemini-3.1-flash-lite
   ```

The script will:

1. Extract the target component structure from the JSON example.
2. Compile the active catalog schema definitions into plain-text positional signatures.
3. Query the Gemini API using the prompt contract system instructions.
4. Compile the returned A2UI Express DSL back into pretty-printed, standard A2UI v1.0 JSON.
5. Validate the final component tree structure, checking parent-child references and data pointer paths.

---

## CLI utility reference

The `express` package provides standalone developer scripts in `specification/proposals/express/scripts/`. Each script dynamically adjusts python paths during execution, allowing them to run directly from any directory when invoked with the appropriate project environment.

### Direct prompt generation

Generate the model prompt contract, containing positional component signatures and rules compiled from the active catalog schema:

```bash
A2UI_EXPRESS_ENABLED=true uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_prompt_generator.py --catalog ../../v1_0/catalogs/basic/catalog.json
```

### Plain DSL compiler

Compile an offline A2UI Express DSL file directly into standard pretty-printed v1.0 JSON:

```bash
A2UI_EXPRESS_ENABLED=true uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_compiler.py \
  path/to/sample.a2ui \
  --surface-id "dashboard_surface"
```

### JSON-to-Express decompiler

Convert standard A2UI v1.0 JSON envelopes back into compact A2UI Express code:

```bash
A2UI_EXPRESS_ENABLED=true uv run --project ../../../agent_sdks/python/a2ui_agent scripts/run_decompiler.py ../../v1_0/catalogs/basic/examples/01_flight-status.json
```

### Regenerate documentation examples

Regenerate the dynamic [express_dsl_examples.md](express_dsl_examples.md) file containing the system prompt contract and compiled weather forecast examples directly from the active code:

```bash
A2UI_EXPRESS_ENABLED=true uv run --project ../../../agent_sdks/python/a2ui_agent scripts/recreate_dsl_examples.py
```
