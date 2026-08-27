# Implementation Plan: A2UI Typesafe API Generator and Programmatic Macros

## 1. Overview and Architecture Strategy

This implementation plan details the steps to:

1. Build the **A2UI Typesafe API Generator** as a standalone package (`agent_sdks/python/a2ui_codegen` v0.1.0) alongside the Agent SDK.
2. Completely remove the legacy YAML format from the Python templating system in favor of **Programmatic Macros**.
3. Provide pre-bundled typesafe Basic Catalog builders and a tree flattener that guarantees root ID stitching and sub-component ID scoping.
4. Migrate all templates in the community example app (`samples/community/templates/`) to programmatic macro functions.
5. Provide exhaustive unit, integration, and end-to-end test suites and documentation.

---

## 2. Non-Experimental Libraries Assessment

To guarantee stability and prevent regressions in production packages:

- **`a2ui_core` (`agent_sdks/python/a2ui_core/`)**:
  - **Zero modifications required**. Existing core classes (`Catalog`, `ComponentApi`, `FunctionApi`, `CatalogSchemaValidator`) remain 100% untouched.
  - To keep `a2ui_core` completely stable, all builder base abstractions (`ComponentBuilderNode`, `ExternalComponentBuilderNode` / `ComponentRef`, `DataBinding`, `Action`, `FunctionCall`, `CheckRule`, `DynamicChildList`, `Surface`, `bind`, `IdAllocator`, `flatten_component_tree`) are hosted directly within the experimental inference format in the Agent SDK (`a2ui.inference_formats.experimental.macros.builder.base`).
  - All schema analysis and type extraction logic is implemented via non-invasive `AnalysedComponentApi` and `AnalysedCatalog` adapter classes located inside `a2ui_codegen`.
- **Client Renderers (`renderers/*`)**:
  - **Zero modifications required**.
  - The macro expansion pipeline produces standard A2UI primitive component dictionaries (`Text`, `Card`, `Column`, `Row`, etc.) that render identically on existing web and mobile renderers.
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

## 4. Package 2: Macros Inference Format & Builders (`a2ui_agent`)

Located in `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/macros/`.

### Directory and File Layout:

```
agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/macros/
├── __init__.py                  # Public exports: macro, Surface, ComponentBuilderNode, etc.
├── decorator.py                 # @macro decorator (with macro_component, dynamic_template aliases)
├── processor.py                 # MacroProcessor (function registry, expansion & flattening)
├── format.py                    # MacroInferenceFormat (catalog prompt synthesis & tool routing)
├── models.py                    # Macro metadata models
├── README.md                    # Complete documentation & usage guide
└── builder/
    ├── __init__.py              # Re-exports: Card, Column, Row, Text, Button, bind, Action, Surface, etc.
    ├── py.typed                 # PEP 561 marker
    ├── base.py                  # Handcrafted runtime base abstractions:
    │                            # ComponentBuilderNode, ExternalComponentBuilderNode (ComponentRef),
    │                            # DataBinding, bind, Action, FunctionCall, CheckRule,
    │                            # DynamicChildList, Surface, IdAllocator, flatten_component_tree
    ├── components.py            # Typesafe Basic Catalog components (Card, Column, Row, Text, Button, etc.)
    ├── functions.py             # Typesafe Basic Catalog functions (formatString, etc.)
    └── types.py                 # Typesafe Basic Catalog enums (TextVariant, FlexJustify, etc.)
```

### Goals:

- **Clean Retirement of YAML Templates**:
  - Deprecate/remove legacy `experimental/template/` YAML loaders (`StaticTemplate.from_yaml*`, `to_yaml`), YAML resolver logic, and inline loop unrolling syntax.
  - Eliminate `pyyaml` dependency from runtime imports.
  - In `experimental/template/__init__.py`, forward exports to `macros` with deprecation notices to maintain backward compatibility for existing scripts.
- **First-Class Programmatic Macros**:
  - Re-anchor the module around `@macro` (with backward-compatible aliases `@macro_component` and `@dynamic_template`).
  - Support programmatic Python functions that accept typed arguments and return typesafe component trees (`ComponentBuilderNode` or `Sequence[ComponentBuilderNode]`).
- **Pre-bundled Basic Catalog Typesafe Builders**:
  - Handcrafted base runtime module (`builder/base.py`):
    - `ComponentBuilderNode`, `ExternalComponentBuilderNode` (`ComponentRef`).
    - `DataBinding`, `bind`.
    - `Action` (`Action.event`, `Action.client_function`).
    - `FunctionCall`, `CheckRule`, `DynamicChildList`.
    - `Surface` (high-level container for direct payload authoring with `.to_dict()`, `.to_json()`, and `.to_messages(version=...)`).
    - `IdAllocator`, `flatten_component_tree`.
  - Generated from `basic/catalog.json` using `a2ui-codegen`:
    - `builder/components.py`: `Card`, `Column`, `Row`, `Text`, `Button`, `Divider`, `Icon`, `Image`, `TextField`, `Slider`, `Switch`, etc.
    - `builder/functions.py`: `formatString`, etc.
    - `builder/types.py`: `TextVariant`, `FlexJustify`, etc.
    - `builder/__init__.py`: Re-exports and `py.typed`.
- **ID Management and Tree Flattening (`builder/base.py`)**:
  - **Root ID stitching**: The returned root node adopts the invocation ID (`id=invocation_id`).
  - **Sub-component namespacing**: Internal sub-components receive scoped IDs (`f"{invocation_id}__{local_id}"`), preventing collisions when multiple instances of the same macro are rendered.
  - **Slot preservation**: Caller-provided slot nodes and `ExternalComponentBuilderNode` references are detected and exempted from namespacing.

---

## 5. Package 3: Community Sample App Migration (`samples/community/templates/`)

Located in `samples/community/templates/`.

### Migration Steps:

1. **Delete all 11 YAML files** from `samples/community/templates/templates/`:
   - `feedback_item.yaml`, `goal_item.yaml`, `salary_card.yaml`, `section_card.yaml`, `team_card.yaml`, `team_feedback_board.yaml`, `team_goal_list.yaml`, `team_member_knowledge_panel.yaml`, `team_roster.yaml`, `two_column_layout.yaml`, `user_profile.yaml`.
2. **Implement Programmatic Python Macro Functions**:
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
   - Replace `StaticTemplate.from_yaml_file` calls with direct registration of the programmatic macro functions.
   - Verify all 12 preset prompts in the demo server continue to formulate identical visual layouts.
4. **Verify Client and E2E**:
   - Run `node test_e2e.mjs` against the updated server to verify that all preset prompts and macros pass end-to-end verification.

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

### 2. Typesafe Builders and Flattener Tests (`agent_sdks/python/a2ui_agent/tests/.../macros/builder/`):

- `test_builders.py`: Verifies instantiating `Card`, `Column`, `Row`, `Text`, `Button`, `Divider`, `Icon` with keyword arguments, data bindings (`bind("/path")`), client actions (`Action.event`, `Action.client_function`), and function calls (`formatString`).
- `test_flattener.py`:
  - Verifies nested tree flattening to A2UI wire format.
  - Verifies root ID anchor stitching (`root_id="user_card_1"`).
  - Verifies sub-component namespacing (`user_card_1__save_btn`).
  - Verifies multi-instance collision prevention on the same surface.
  - Verifies slot boundary preservation (exempting caller slot nodes and `ExternalComponentBuilderNode` from namespacing).

### 3. Macro Processor & Inference Tests (`agent_sdks/python/a2ui_agent/tests/.../macros/`):

- `test_processor.py`:
  - Tests synchronous expansion of programmatic macro functions.
  - Tests error handling when required parameters are omitted or invalid types are passed.
  - Tests programmatic data fetching and layout assembly within macro functions.
  - Tests integration with `MacroInferenceFormat` (prompt generation and tool interception).

### 4. Sample App E2E Tests:

- Run `test_e2e.mjs` in `samples/community/templates/` to guarantee all 12 preset templates render correctly on the React client without regression.

---

## 7. Phased Execution Steps

1. **Phase 1: Build `a2ui_codegen` package**:
   - Create `agent_sdks/python/a2ui_codegen/` with `pyproject.toml`, `types.py`, `analyzer.py`, `emitter/python.py`, `cli.py`, and `README.md`.
   - Add to root `pyproject.toml` workspace members.
   - Write and pass all codegen unit tests (`pytest`).
2. **Phase 2: Build `macros` Inference Format and Builders**:
   - Implement handcrafted base runtime module in `a2ui_agent/src/a2ui/inference_formats/experimental/macros/builder/base.py`.
   - Run `a2ui-codegen` against Basic Catalog v0.9.1 to produce pre-bundled builders (`components.py`, `functions.py`, `types.py`, `__init__.py`).
   - Implement `@macro`, `MacroProcessor`, and `MacroInferenceFormat`.
   - Deprecate/forward legacy `template/` module.
   - Add exhaustive unit tests in `a2ui_agent/tests/inference_formats/experimental/macros/`.
3. **Phase 3: Migrate Community Sample App**:
   - Delete `.yaml` files in `samples/community/templates/templates/`.
   - Implement all 11 macro functions in Python using the typesafe builder interface.
   - Update `server.py` to register programmatic functions.
   - Run and verify `samples/community/templates/test_e2e.mjs`.
4. **Phase 4: Format, Lint, License, and Verification**:
   - Format Python code with Pyink.
   - Verify license headers with `./scripts/fix_licenses.py --check`.
   - Run full test suites across packages.
