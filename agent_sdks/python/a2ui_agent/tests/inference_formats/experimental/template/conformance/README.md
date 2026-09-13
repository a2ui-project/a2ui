# A2UI Template Conformance Test Suite

This directory contains the language-agnostic, data-driven conformance test suite for A2UI Templates.

While currently maintained within the Python Agent SDK (`agent_sdks/python/a2ui_agent/tests/inference_formats/experimental/template/conformance/`), the suite is defined entirely in declarative YAML and JSON Schema to enable seamless graduation to the root `conformance/templates/` directory as cross-platform SDKs (Dart, TypeScript, Kotlin) add template engines.

---

## Directory Structure

```
conformance/
├── schema/
│   └── template_conformance_schema.json     <-- JSON Schema validating all YAML test suites
├── suites/
│   ├── 01_substitution.yaml                  <-- Exact match, interpolation, AST expressions, token escaping
│   ├── 02_static_expansion.yaml              <-- Single/multi-child expansion, slots, data bindings
│   ├── 03_loop_unrolling.yaml                <-- Inline loops, named loops, empty arrays, 2D unrolling
│   ├── 04_parameter_validation.yaml          <-- Parameter type enforcement, enum validation, required fields
│   ├── 05_message_interception.yaml          <-- createSurface, updateComponents, multi-envelope streams
│   └── 06_error_invariants.yaml              <-- Unregistered templates, cycle guards, recursion limits
├── test_template_conformance.py              <-- Pytest harness running the entire suite
└── README.md
```

---

## Action Runners

Each test case declares an `action` attribute:

1. **`substitute_params`**:
   - Tests `_substitute_params(val, params)` directly.
   - Asserts exact value and type preservation (integers, booleans, objects, arrays), string interpolation, AST expressions (`format`, `concat`), and literal escaping (`\${token}`).

2. **`expand_template`**:
   - Registers defined template(s) with `TemplateProcessor`.
   - Executes `processor.expand_template(instance_id, template_id, args)`.
   - Asserts exact component list structure and synthetic ID generation.

3. **`process_message`**:
   - Intercepts A2UI messages (`createSurface`, `updateComponents`).
   - Asserts unrolling of template instances into standard primitive components.

4. **`validate_template`**:
   - Tests template ingestion and version validation (`version: "0.1"`).
   - Asserts validation errors on invalid or missing version fields.

---

## Graduation to Cross-Platform

When A2UI Templates graduate from experimental to standard protocol:

1. Move the entire `conformance/` directory to root:
   ```bash
   mv agent_sdks/python/a2ui_agent/tests/inference_formats/experimental/template/conformance/       conformance/templates/
   ```
2. The `suites/*.yaml` test definitions require **zero modifications**.
3. Implement standard harnesses in other target languages:
   - **TypeScript / React / Lit**: Vitest harness reading `suites/*.yaml`.
   - **Dart / Flutter**: `package:test` harness reading `suites/*.yaml`.
   - **Kotlin**: JUnit5 harness reading `suites/*.yaml`.
