---
name: a2ui-generate-pydantic-models
description: Automated generator for strongly typed Pydantic v2 data models and basic catalogs across any A2UI protocol version (v0.8, v0.9, v0.9.1, v1.0, etc.).
---

# A2UI Pydantic Model Generation Skill

This skill provides an automated code generation tool that produces strongly typed Pydantic v2 data models and basic catalog definitions for `python/a2ui_core` directly from the schemas and catalogs in `specification/<version>/`.

---

## Agent Execution Steps

When given a prompt like _"Generate Pydantic model classes for A2UI spec v1.0"_:

1. **Extract the target version parameter from the prompt** (e.g. `v1.0` -> `v1.0`).

2. **Execute the generator script exactly once for that target version**:

   ```bash
   uv run python .agents/skills/a2ui-generate-pydantic-models/scripts/codegen_pydantic.py --version <TARGET_VERSION>
   ```

   _(Replace `<TARGET_VERSION>` with the single requested version, e.g. `--version v1.0`)_.

3. **Format generated Python code**:

   ```bash
   cd python/a2ui_core
   uv run pyink .
   ```

4. **Verify the generated files** by running pytest:

   ```bash
   cd python/a2ui_core
   uv run pytest tests/test_codegen_pydantic.py
   ```

5. **Stop and report completion to the user.**

---

## Generated Output Files per Version

When executed for a target version `<version>` (e.g. `v1.0` -> `v1_0`), the script generates:

1. **`python/a2ui_core/src/a2ui/core/schema/<version>/`**:
   - `constants.py`
   - `common_types.py`
   - `agent_to_renderer.py` / `server_to_client.py`
   - `renderer_to_agent.py` / `client_to_server.py`
   - `renderer_capabilities.py` / `client_capabilities.py`
   - `agent_capabilities.py` / `server_capabilities.py` (when present in spec)
   - `catalog_definition.py` (when present in spec)
   - `__init__.py`

2. **`python/a2ui_core/src/a2ui/core/basic_catalog/<version>/`**:
   - `components.py` (strongly typed components & `ModelComponentApi` registrations)
   - `function_apis.py` (strongly typed function schemas & `FunctionApi` classes)
   - `styles.py` (theme schema, generated when theme is defined in catalog)
   - `__init__.py`

3. **`python/a2ui_core/src/a2ui/core/schema/__init__.py`**:
   - Registers the version in `A2uiProtocolVersion` enum and updates envelope unions.
