# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff   |
| :------------------------------- | :------- | :------ | :----- |
| **Pytest Conformance**           | PASS     | FAIL    | -      |
| **Overall Pass Rate**            | 100.0%   | 83.3%   | -16.7% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 100.0%  | 0.0%   |
| **Inference Duration (sec)**     | 8.79s    | 9.14s   | +4.0%  |
| **Avg Input Tokens**             | 0        | 0       | -      |
| **Avg Output Tokens**            | 0        | 0       | -      |

## ❌ Pytest Unit Test Failures

```
============================= test session starts ==============================
platform linux -- Python 3.13.14, pytest-9.1.1, pluggy-1.6.0
rootdir: /usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24
configfile: pyproject.toml
plugins: asyncio-1.4.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 8 items / 28 errors

==================================== ERRORS ====================================
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py:20: in <module>
    from a2ui.adk.a2a.event_converter import A2uiEventConverter
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py:21: in <module>
    from a2a import types as a2a_types
E   ModuleNotFoundError: No module named 'a2a'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py:18: in <module>
    from google.adk.sessions.session import Session
E   ModuleNotFoundError: No module named 'google'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py:20: in <module>
    from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/elemental/test_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_format.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py:43: in <module>
    import run_compiler
specification/proposals/express/scripts/run_compiler.py:45: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_compiler.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/express/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_integration.py:24: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
__ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py:15: in <module>
    from a2ui.inference_formats.transport.format import TransportFormat
agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/transport/__init__.py:15: in <module>
    from .format import TransportFormat
agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/transport/format.py:21: in <module>
    from a2ui.inference_format import InferenceFormat
agent_sdks/python/a2ui_agent/src/a2ui/inference_format.py:20: in <module>
    from a2ui.prompt import PromptGenerator
agent_sdks/python/a2ui_agent/src/a2ui/prompt/__init__.py:17: in <module>
    from .generator import PromptGenerator
agent_sdks/python/a2ui_agent/src/a2ui/prompt/generator.py:19: in <module>
    from a2ui.core.schema.client_capabilities import V09Capabilities
E   ModuleNotFoundError: No module named 'a2ui.core'
___ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_utils.py ___
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/schema/test_utils.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_utils.py:19: in <module>
    from a2ui.core.exceptions import A2uiCatalogError
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/schema/test_validator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
___ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_atom_format.py ____
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/test_atom_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_atom_format.py:19: in <module>
    from a2ui.inference_formats.experimental.atom.compiler import AtomCompiler
agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/__init__.py:17: in <module>
    from .format import AtomFormat
agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/format.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_____ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_formats.py ______
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/test_formats.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_formats.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run24/agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py:22: in <module>
    from a2ui.basic_catalog import BasicCatalog
agent_sdks/python/a2ui_agent/src/a2ui/basic_catalog/__init__.py:15: in <module>
    from .provider import BasicCatalog
agent_sdks/python/a2ui_agent/src/a2ui/basic_catalog/provider.py:17: in <module>
    from ..schema.catalog import CatalogConfig, resolve_examples_path
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
=========================== short test summary info ============================
ERROR agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py
ERROR agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py
ERROR agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py
ERROR agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py
ERROR agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py
ERROR agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py
ERROR agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py
ERROR agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py
ERROR agent_sdks/python/a2ui_agent/tests/elemental/test_format.py
ERROR agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py
ERROR agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py
ERROR agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py
ERROR agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py
ERROR agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
ERROR agent_sdks/python/a2ui_agent/tests/express/test_integration.py
ERROR agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py
ERROR agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py
ERROR agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py
ERROR agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py
ERROR agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py
ERROR agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py
ERROR agent_sdks/python/a2ui_agent/tests/schema/test_utils.py
ERROR agent_sdks/python/a2ui_agent/tests/schema/test_validator.py
ERROR agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py
ERROR agent_sdks/python/a2ui_agent/tests/test_atom_format.py
ERROR agent_sdks/python/a2ui_agent/tests/test_formats.py
ERROR agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py
ERROR agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py
!!!!!!!!!!!!!!!!!!! Interrupted: 28 errors during collection !!!!!!!!!!!!!!!!!!!
============================== 28 errors in 0.42s ==============================

warning: `VIRTUAL_ENV=/usr/local/google/home/gspencer/code/a2ui/atom_format/.venv` does not match the project environment path `.venv` and will be ignored; use `--active` to target the active environment instead
Using CPython 3.13.14 interpreter at: /usr/bin/python3
Creating virtual environment at: .venv
Installed 22 packages in 93ms

```

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index fe0765d9..2c60505e 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -23,66 +23,32 @@ if TYPE_CHECKING:
     from .format import AtomFormat

 ATOM_RULES = r'''# A2UI Atom Output Contract
-
-You must output the user interface using the compact A2UI Atom S-Expression notation.
-You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and `</a2ui>`. Do NOT output raw JSON messages.
-
-## Grammar Rules
-
-1. Every component node is a parenthesized expression starting with the ComponentName:
-   (ComponentName :key1 val1 :key2 val2 child1 child2 ...)
-
-2. Primitives:
-   - Strings: Double-quoted, e.g., "Hello". Escapes: \n, \t, \\, \".
-   - Numbers: Integers or decimals, e.g., 42 or 3.14.
-   - Booleans: true or false.
-   - Null: null.
-
-3. Property Arguments:
-   - Tagged attributes: Prefixed with a colon ':', e.g., :attr1 "val1" or :attr2 true. Tagged keys are order-independent.
-   - Positional attributes: Can be passed sequentially matching catalog signature order.
-
-4. Child Components & Strict Tree Nesting:
-   - You MUST nest child components directly inside their parent container expressions, e.g., (ContainerComponent (ChildComponent (PrimitiveComponent "Hello"))).
-   - Do NOT output flat adjacency lists, explicit `:id` attributes, or separate component variable IDs. Every UI component must be nested directly within a single root tree expression.
-
-5. Data Bindings:
-   - Absolute data model paths start with '$/', e.g., $/user/firstName.
-   - Relative template item fields start with '$/item_var/field', e.g. $/item/name.
-
-6. Data Model Population:
-   - Initialize data model state using (data $/path1 "val1" $/path2 123) or (data $/map_path (:key1 "val1" :key2 "val2")).
-
-7. Dynamic List Templates:
-   - List templates use (template :item item (ChildComponent $/item/name)) or (ListComponent :children (template :item item (ChildComponent $/item/name))).
-
-8. Action Events:
-   - Actions use (Event "action_name" :param1 $/value). Interactive controls with action attributes MUST provide an action expression, e.g., (ActionComponent :child (ChildComponent "Text") :action (Event "click_action")).
-
-9. Standalone Operations:
-   - Delete surface: (deleteSurface "surface_id")
-   - Call RPC function: (callFunction "function_name" :arg1 "value1")
-
-10. Syntax Structure Examples (Abstract Grammar):
-   Example 1 (Container with Child Nodes & Actions):
-   <a2ui>
-   (ContainerComponent
-     (ChildComponent :title "Header")
-     (InputComponent :label "Input" :value $/form/field)
-     (ActionComponent :label "Submit" :action (Event "submit_action" :val $/form/field)))
-   </a2ui>
-
-   Example 2 (Root Data State & Dynamic Template):
-   <a2ui>
-   (ContainerComponent
-     (data $/items [(:id 1 :name "Item 1")] $/title "List Title")
-     (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
-   </a2ui>
-
-11. Strict Catalog Adherence & Conciseness:
-   - You MUST ONLY use property names listed in the Component Catalog Signatures below.
-   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize, size, minHeight, borderRadius, spacing, align, justify).
-   - Output minimal properties required to satisfy the user request.
+Output UI using compact A2UI Atom S-Expressions wrapped in `<a2ui>` and `</a2ui>`. Do NOT output raw JSON.
+
+1. Component AST: (ComponentName :key1 val1 :key2 val2 child1 child2 ...)
+2. Primitives: Strings ("Hello"), Numbers (42, 3.14), Booleans (true/false), Null (null).
+3. Attributes: Tagged (:attr "val", order-independent) or positional (matching catalog order).
+4. Direct Tree Nesting: Nest child components directly inside parent container expressions: (ContainerComponent (ChildComponent (PrimitiveComponent "Text"))). Do NOT output flat lists or explicit :id attributes.
+5. Data Bindings: Absolute paths start with $/ ($/path). Relative template fields use $/item_var/field ($/item/name).
+6. Data Model: Initialize state using (data $/path "val") or (data $/map (:key "val")).
+7. List Templates: Use (template :item item (ChildComponent $/item/name)).
+8. Actions: Use (Event "action_name" :param $/path). Interactive controls requiring action must specify an action expression: (ActionComponent :child (ChildComponent "Text") :action (Event "click")).
+9. Operations: Delete: (deleteSurface "id"); RPC: (callFunction "func" :arg "val").
+10. Abstract Grammar Examples:
+    Example 1:
+    <a2ui>
+    (ContainerComponent
+      (ChildComponent :title "Header")
+      (InputComponent :label "Input" :value $/form/field)
+      (ActionComponent :label "Submit" :action (Event "submit_action" :val $/form/field)))
+    </a2ui>
+    Example 2:
+    <a2ui>
+    (ContainerComponent
+      (data $/items [(:id 1 :name "Item 1")] $/title "List Title")
+      (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
+    </a2ui>
+11. Catalog Adherence: Use ONLY property names listed in Component Catalog Signatures. Do NOT invent style/CSS attributes. Output minimal required properties.
 '''
```

## Failure Details (Count: 1 / 6)

### ❌ Sample: `dogBreedGenerator`

- **Algorithmic Schema**: `PASS`
- **LLM Judge Grade**: `I`
- **Prompt**:

  > Use a surfaceId of 'main'. Generate a 'createSurface' message to describe the following UI:
  >
  > A vertical list with:
  >
  > - Dog breed information
  > - Dog generator
  >
  > The dog breed information is a card, which contains a title “Famous Dog breeds”, a header image, and a horizontal list of images of different dog breeds (using a 'List' component). The list information should be in the data model at /breeds.
  >
  > The dog generator is another card which is a form that generates a fictional dog breed with a description
  >
  > - Title
  > - Description text explaining what it is
  > - Dog breed name (text input)
  > - Number of legs (number input)
  > - Button called “Generate” which takes the data above and generates a new dog description
  > - Skills (ChoicePicker component, variant 'multipleSelection')
  > - A divider
  > - A section which shows the generated content

- **Raw Model Output**:

  ```
  <a2ui>
  (Column
    (data
      $/breeds [
        "https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&q=80&w=200"
        "https://images.unsplash.com/photo-1537151608828-ea2b117b6221?auto=format&fit=crop&q=80&w=200"
        "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&q=80&w=200"
        "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&q=80&w=200"
      ]
      $/skills_options [
        "Laser Eyes"
        "Telepathy"
        "Super Speed"
        "Invisibility"
        "Rainbow Bark"
        "Nap Master"
      ]
      $/form/name "Robo-Pug"
      $/form/legs "6"
      $/form/skills ["Laser Eyes", "Nap Master"])

    (Card
      :child (Column
        (Text :text "Famous Dog breeds" :variant "body")
        (Image :url "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&q=80&w=800" :description "Famous Dog breeds header" :variant "header")
        (List
          :direction "horizontal"
          :children (template breed (Image :url $/breed :variant "smallFeature")))))

    (Card
      :child (Column
        (Text :text "Fictional Dog Breed Generator" :variant "body")
        (Text :text "Design your own custom fictional breed of dog and generate its description." :variant "caption")
        (TextField :label "Dog breed name" :value $/form/name :variant "shortText")
        (TextField :label "Number of legs" :value $/form/legs :variant "number")
        (ChoicePicker
          :label "Skills"
          :variant "multipleSelection"
          :options $/skills_options
          :value $/form/skills
          :displayStyle "chips")
        (Button
          :child (Text :text "Generate")
          :variant "primary"
          :action (Event "generate" :name $/form/name :legs $/form/legs :skills $/form/skills))
        (Divider :axis "horizontal")
        (Column
          (Text :text "Generated Dog Breed Profile" :variant "body")
          (Text :text (formatString "The legendary ${/form/name} is a majestic creature.") :variant "body")
          (Text :text (formatString "It runs swiftly on its ${/form/legs} powerful legs.") :variant "body")
          (Text :text (formatString "Known skills: ${/form/skills}") :variant "caption")))))
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To determine if the submission meets the criterion, let's break down the requirements step by step:
  >
  > 1. **Target `surfaceId` 'main':**
  >    - Looking at the JSON payload, the `createSurface` command has the property `"surfaceId": "main"`. This successfully targets the 'main' surface.
  > 2. **Contain Data Model Updates (or Initial Data):**
  >    - The submission includes the `"dataModel"` property inside the `"createSurface"` action. This is the correct way to initialize the data model for the surface.
  > 3. **Set data model paths `/user/name` to "John Doe" and `/user/email` to "john.doe@example.com":**
  >    - In the `"dataModel"` object, we have:
  >      ```json
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >      ```
  >    - This mapping corresponds to the JSON paths `/user/name` equaling `"John Doe"` and `/user/email` equaling `"john.doe@example.com"`.
  >
  > The submission successfully initializes the surface 'main' and populates its data model with the exact values and paths requested in the task description.
  >
  > GRADE: C
