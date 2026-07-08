---
codebase_path: agent_sdks/python/a2ui_agent
associated_module: a2ui_inference
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'uv run pytest'
  lint_command: 'uv run pyink --check .'
  format_command: 'uv run pyink .'
---

# **Python Agent SDK Codebase Blueprint**

## **Architecture & Ecosystem Map**

The reference Python implementation of the A2UI Agent/Inference SDK (`a2ui_inference`).

- **Prompt Engineering**: Dynamic system instructions engine utilizing `A2uiSchemaManager` to load and compile bundled component schemas from schemas folder.
- **Streaming & Parsing**: Uses regex-based real-time block extraction (`re.DOTALL` tag searches) inside `A2uiStreamParser` to isolate JSON segments from LLM streams on the fly.
- **Validation & Fixing**: Employs `PayloadFixer` to automatically heal invalid trailing commas and close bracket anomalies before structural validation is invoked.

## **Local Technical Decisions & Overrides**

- **ADK Integration**: Direct adapters exposed inside `src/a2ui/adk` to hook seamlessly into Python Agent Development Kit (ADK) event streams.
- **Resource Loading**: Bundles standard schema assets using standard `importlib.resources`, reverting to directory checking during local development modes.

## **Validation & Execution Recipes**

- **Test execution**: Run unit/integration tests with `uv run pytest`.
- **Linting check**: Check style boundaries with `uv run pyink --check .`.
- **Formatting**: Format codebase via `uv run pyink .`.
