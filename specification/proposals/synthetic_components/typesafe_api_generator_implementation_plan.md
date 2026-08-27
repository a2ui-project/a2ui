# Implementation Plan: A2UI Typesafe API Generator and Programmatic Synthetic Components

## 1. Overview and Architecture Strategy

This implementation plan details the steps to:

1. Build the **A2UI Typesafe API Generator** as a standalone package (`agent_sdks/python/a2ui_codegen` v0.1.0) alongside the Agent SDK.
2. Completely remove the legacy YAML format from the Python templating system in favor of **Programmatic Synthetic Components**.
3. Provide pre-bundled typesafe Basic Catalog builders and a tree flattener that guarantees root ID stitching and sub-component ID scoping.
4. Migrate all templates in the community example app (`samples/community/templates/`) to programmatic code functions.
5. Provide exhaustive unit, integration, and end-to-end test suites and documentation.

---

## 2. Non-Experimental Libraries Assessment

To guarantee stability and prevent regressions in production packages:

- **`a2ui_core` (`agent_sdks/python/a2ui_core/`)**:
  - **Zero modifications required**.
  - Core classes (`Catalog`, `ComponentApi`, `FunctionApi`, `CatalogSchemaValidator`) remain 100% untouched.
  - All schema analysis and type extraction logic is implemented via the non-invasive `AnalysedComponentApi` and `AnalysedCatalog` adapter classes located inside `a2ui_codegen`.
- **Client Renderers (`renderers/*`)**:
  - **Zero modifications required**.
  - The synthetic component expansion pipeline produces standard A2UI primitive component dictionaries (`Text`, `Card`, `Column`, `Row`, etc.) that render identically on existing web and mobile renderers.
- **Workspace Configuration (`pyproject.toml`)**:
  - The only change in non-experimental configuration is registering the new `agent_sdks/python/a2ui_codegen` package in root `pyproject.toml` under `[tool.uv.workspace] members`.

---

## 3. Package 1: Standalone Code Generator (`a2ui_codegen` v0.1.0)

A new package created at `agent_sdks/python/a2ui_codegen/`.

### Directory and File Layout

```
agent_sdks/python/a2ui_codegen/
├── pyproject.toml
├── README.md
├── src/
│   └── a2ui/
│       └── codegen/
│           ├── __init__.py
│           ├── cli.py               # CLI entry point (argparse: --catalog, --lang, --out, --package-name)
│           ├── types.py             # Strongly typed TypeDescriptor algebraic sum types
│           ├── analyzer.py          # AnalysedCatalog and AnalysedComponentApi wrapping CatalogSchemaHelper
│           └── emitter/
│               ├── __init__.py
│               ├── base.py          # Abstract BaseEmitter
│               └── python.py        # PythonEmitter generating types.py, components.py, functions.py, __init__.py
└── tests/
    ├── __init__.py
    ├── test_types.py                # Tests TypeDescriptor hierarchy and exhaustiveness
    ├── test_analyzer.py             # Tests schema crawling, property detection, enum extraction
    ├── test_python_emitter.py       # Tests emitted Python code syntax, imports, and docstrings
    └── test_cli.py                  # Tests CLI execution via subprocess / Runner against Basic Catalog
```

### Key Components:

1. **`types.py` (Algebraic Type Descriptor System)**:
   - Replaces stringly-typed `target_type: str` with typed immutable dataclasses:
     - `PrimitiveType(PrimitiveKind)` (`STRING`, `INTEGER`, `FLOAT`, `BOOLEAN`, `ANY`).
     - `EnumType(name, values)`.
     - `ComponentRefType()` (single child slot).
     - `ComponentListType()` (children sequence slot).
     - `DynamicType(inner)` (wraps primitive into `T | DataBinding | FunctionCall`).
     - `ActionType()`, `DataBindingType()`, `ListType(element_type)`, `MapType(value_type)`, `UnionType(options)`.
   - `TypeDescriptor` algebraic sum type.
2. **`analyzer.py` (Non-Invasive Schema Analysis)**:
   - Leverages the existing `CatalogSchemaHelper` from `a2ui.schema.schema_helper`.
   - Implements `AnalysedComponentApi` wrapping `ComponentApi` without modifying `a2ui_core`.
   - Resolves component properties into `PropertyApi(name, type_desc, required, description, default_value)`.
3. **`emitter/python.py` (Python Code Generator)**:
   - Consumes `AnalysedCatalog`.
   - Emits:
     - `types.py`: `Literal[...]` unions for catalog enums.
     - `components.py`: Typed `@dataclass(kw_only=True)` classes implementing `ComponentBuilderNode` and `.to_dict()`.
     - `functions.py`: Callable wrapper functions returning `FunctionCall`.
     - `__init__.py`: Re-exports and `py.typed` marker.
4. **`cli.py`**:
   - Command-line parser with flags: `--catalog`, `--lang` (defaults to `"python"`), `--out`, `--package-name`.
   - Formats emitted code using `pyink` or `black` if available.

---

## 4. Package 2: Templating System Overhaul (`a2ui_agent`)

Located in `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/template/`.

### Goals:

- **Complete YAML Removal**:
  - Delete all YAML loading methods (`StaticTemplate.from_yaml*`, `to_yaml`), YAML resolver logic, and inline YAML loop unrolling syntax.
  - Remove `pyyaml` dependency from `template` module imports.
- **First-Class Programmatic Synthetic Components**:
  - Re-anchor the module around `@synthetic_component` (with backward-compatible alias `dynamic_template`).
  - Support programmatic Python functions that accept typed arguments and return typesafe component trees (or dictionaries).
- **Pre-bundled Basic Catalog Typesafe Builders**:
  - Generate and pre-bundle the typed builders for the official Basic Catalog directly under `template/builder/`:
    - `builder/base.py`: `ComponentBuilderNode`, `DataBinding`, `bind`, `Action`, `FunctionCall`.
    - `builder/components.py`: `Card`, `Column`, `Row`, `Text`, `Button`, `Divider`, `Icon`, `Image`, `TextField`, `Slider`, `Switch`, etc.
    - `builder/functions.py`: `formatString`, etc.
    - `builder/types.py`: `TextVariant`, `FlexJustify`, etc.
    - `builder/flattener.py`: Tree flattening with invocation ID stitching and scoped sub-component IDs.
- **ID Management and Tree Flattening (`builder/flattener.py`)**:
  - **Root ID stitching**: The returned root node adopts the invocation ID (`id=invocation_id`).
  - **Sub-component namespacing**: Internal sub-components receive scoped IDs (`f"{invocation_id}__{local_id}"`), preventing collisions when multiple instances of the same synthetic component are rendered.
  - **Slot preservation**: Caller-provided slot nodes are detected and exempted from namespacing.

---

## 5. Package 3: Community Sample App Migration (`samples/community/templates/`)

Located in `samples/community/templates/`.

### Migration Steps:

1. **Delete all 11 YAML files** from `samples/community/templates/templates/`:
   - `feedback_item.yaml`, `goal_item.yaml`, `salary_card.yaml`, `section_card.yaml`, `team_card.yaml`, `team_feedback_board.yaml`, `team_goal_list.yaml`, `team_member_knowledge_panel.yaml`, `team_roster.yaml`, `two_column_layout.yaml`, `user_profile.yaml`.
2. **Implement Programmatic Python Template Functions**:
   - Create Python functions in `samples/community/templates/templates/` using the typesafe builder API:
     - `user_profile.py`: `user_profile(userId, userName, role) -> Card`
     - `salary_card.py`: `employee_salary_card(employeeId) -> Card` (resolves employee compensation from internal DB and constructs Card)
     - `section_card.py`: `section_card(title, description, headerAction, children) -> Card`
     - `two_column_layout.py`: `two_column_layout(headerChild, leftChildren, rightChildren) -> Column`
     - `knowledge_panel.py`: `team_member_knowledge_panel(userName, role, experienceYears, completedTasks) -> Card`
     - `goal_list.py`: `team_goal_list(teamName, goals) -> Card` and `goal_item(title, priority, targetDate) -> Row`
     - `feedback_board.py`: `team_feedback_board(teamName, feedbacks) -> Card` and `feedback_item(author, note, rating) -> Row`
     - `team_card.py`: `team_card(teamName, members) -> Card`
     - `team_roster.py`: `team_roster(directoryTitle, children) -> Column`
     - `payroll_summary.py`: Existing `render_payroll_summary` refactored to use the typesafe builder API.
3. **Update `server.py`**:
   - Replace `StaticTemplate.from_yaml_file` calls with direct registration of the programmatic template functions.
   - Verify all 12 preset prompts in the demo server continue to formulate identical visual layouts.
4. **Verify Client and E2E**:
   - Run `node test_e2e.mjs` against the updated server to verify that all preset prompts and dynamic templates pass end-to-end verification.

---

## 6. Comprehensive Testing Plan

### 1. `a2ui_codegen` Tests (`agent_sdks/python/a2ui_codegen/tests/`):

- `test_types.py`: Unit tests verifying that `TypeDescriptor` pattern matching handles all variants (primitives, dynamics, enums, child slots, lists, maps, unions).
- `test_analyzer.py`: Ingests Basic Catalog v0.9.1 and v1.0 schemas using `AnalysedCatalog`, verifying correct extraction of components (`Card`, `Text`, `Column`), child slots (`child` vs `children`), dynamic properties (`DynamicString`), and enum choices.
- `test_python_emitter.py`: Generates code into an in-memory or temporary directory and verifies:
  - Valid Python syntax (`ast.parse`).
  - Correct typing annotations (`mypy` / `pyright`).
  - Proper docstrings from catalog descriptions.
- `test_cli.py`: Invokes `a2ui-codegen` CLI via `subprocess` against official schemas and verifies exit code 0 and generated file structure.

### 2. Typesafe Builders and Flattener Tests (`agent_sdks/python/a2ui_agent/tests/.../builder/`):

- `test_builders.py`: Verifies instantiating `Card`, `Column`, `Row`, `Text`, `Button`, `Divider`, `Icon` with keyword arguments, data bindings (`bind("/path")`), client actions (`Action.event`, `Action.client_function`), and function calls (`formatString`).
- `test_flattener.py`:
  - Verifies nested tree flattening to A2UI wire format.
  - Verifies root ID anchor stitching (`root_id="user_card_1"`).
  - Verifies sub-component namespacing (`user_card_1__save_btn`).
  - Verifies multi-instance collision prevention on the same surface.
  - Verifies slot boundary preservation (exempting caller slot nodes from namespacing).

### 3. Template Processor Tests (`agent_sdks/python/a2ui_agent/tests/.../template/`):

- `test_processor.py`:
  - Tests synchronous expansion of programmatic template functions.
  - Tests error handling when required parameters are omitted or invalid types are passed.
  - Tests dynamic resolver execution (server-side data fetching).
  - Tests integration with `TemplateInferenceFormat` (prompt generation and tool interception).

### 4. Sample App E2E Tests:

- Run `test_e2e.mjs` in `samples/community/templates/` to guarantee all 12 preset templates render correctly on the React client without regression.

---

## 7. Phased Execution Steps

1. **Phase 1: Build `a2ui_codegen` package**:
   - Create `agent_sdks/python/a2ui_codegen/` with `pyproject.toml`, `types.py`, `analyzer.py`, `emitter/python.py`, `cli.py`, and `README.md`.
   - Add to root `pyproject.toml` workspace members.
   - Write and pass all codegen unit tests (`pytest`).
2. **Phase 2: Generate and pre-bundle Basic Catalog Builders**:
   - Run `a2ui-codegen` against Basic Catalog v0.9.1 to produce pre-bundled builders under `a2ui_agent/src/a2ui/inference_formats/experimental/template/builder/`.
   - Implement `flattener.py` with root ID stitching and sub-component namespacing.
   - Add unit tests for builders and flattener.
3. **Phase 3: Overhaul Templating System**:
   - Remove YAML parsing and YAML models from `models.py` and `processor.py`.
   - Update `TemplateProcessor` and `TemplateInferenceFormat` to expand programmatic synthetic component functions.
   - Update all unit tests in `a2ui_agent/tests/inference_formats/experimental/template/`.
4. **Phase 4: Migrate Community Sample App**:
   - Delete `.yaml` files in `samples/community/templates/templates/`.
   - Implement all 11 template functions in Python using the typesafe builder interface.
   - Update `server.py` to register programmatic functions.
   - Run and verify `samples/community/templates/test_e2e.mjs`.
5. **Phase 5: Format, Lint, License, and Verification**:
   - Format Python code with Pyink.
   - Verify license headers with `./scripts/fix_licenses.py --check`.
   - Run full test suites across packages.
