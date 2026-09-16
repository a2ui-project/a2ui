# Inference Format Optimization Report
- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table
| Metric | Baseline | Current | Diff |
| :--- | :--- | :--- | :--- |
| **Pytest Conformance** | PASS | FAIL | - |
| **Overall Pass Rate** | 0.0% | 100.0% | - |
| **Algorithmic Schema Pass Rate** | 0.0% | 100.0% | - |
| **Inference Duration (sec)** | 0.00s | 8.87s | - |
| **Avg Input Tokens** | 0 | 0 | - |
| **Avg Output Tokens** | 0 | 0 | - |

## ❌ Pytest Unit Test Failures
```
============================= test session starts ==============================
platform linux -- Python 3.13.14, pytest-9.1.1, pluggy-1.6.0
rootdir: /usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45
configfile: pyproject.toml
plugins: asyncio-1.4.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 8 items / 28 errors

==================================== ERRORS ====================================
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py:20: in <module>
    from a2ui.adk.a2a.event_converter import A2uiEventConverter
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py:21: in <module>
    from a2a import types as a2a_types
E   ModuleNotFoundError: No module named 'a2a'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py:18: in <module>
    from google.adk.sessions.session import Session
E   ModuleNotFoundError: No module named 'google'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py:20: in <module>
    from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/elemental/test_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_format.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py:43: in <module>
    import run_compiler
specification/proposals/express/scripts/run_compiler.py:45: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_compiler.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/express/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_integration.py:24: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
__ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/schema/test_utils.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_utils.py:19: in <module>
    from a2ui.core.exceptions import A2uiCatalogError
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/schema/test_validator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
___ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_atom_format.py ____
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/test_atom_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/test_formats.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_formats.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run45/agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py'.
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
============================== 28 errors in 0.45s ==============================

warning: `VIRTUAL_ENV=/usr/local/google/home/gspencer/code/a2ui/atom_format/.venv` does not match the project environment path `.venv` and will be ignored; use `--active` to target the active environment instead
Using CPython 3.13.14 interpreter at: /usr/bin/python3
Creating virtual environment at: .venv
Installed 22 packages in 69ms

```

## Active Git Diff
```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 252fb518..472c6333 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -169,11 +169,11 @@ class AtomPromptGenerator(PromptGenerator):
 
                 if p_desc or enum_vals:
                     p_line_parts = []
-                    if p_desc:
-                        p_line_parts.append(p_desc)
                     if enum_vals:
-                        enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
-                        p_line_parts.append(f"Must be one of: {enum_vals_str}")
+                        enum_vals_str = "|".join(enum_vals)
+                        p_line_parts.append(f"[{enum_vals_str}]")
+                    if p_desc and not (enum_vals and p_desc.lower().startswith("must be")):
+                        p_line_parts.append(p_desc)
                     prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")
 
             sig = f"- ({name} {' '.join(ordered_args)})"
@@ -209,11 +209,11 @@ class AtomPromptGenerator(PromptGenerator):
 
                 if p_desc or enum_vals:
                     p_line_parts = []
-                    if p_desc:
-                        p_line_parts.append(p_desc)
                     if enum_vals:
-                        enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
-                        p_line_parts.append(f"Must be one of: {enum_vals_str}")
+                        enum_vals_str = "|".join(enum_vals)
+                        p_line_parts.append(f"[{enum_vals_str}]")
+                    if p_desc and not (enum_vals and p_desc.lower().startswith("must be")):
+                        p_line_parts.append(p_desc)
                     prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")
 
             sig = f"- ({name} {' '.join(ordered_args)})"
```

## Failure Details (Count: 0 / 6)
🎉 *All tests passed successfully!*