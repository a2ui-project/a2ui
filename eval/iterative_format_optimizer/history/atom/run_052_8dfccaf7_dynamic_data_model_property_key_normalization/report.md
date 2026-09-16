# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | PASS     | FAIL    | -    |
| **Overall Pass Rate**            | 0.0%     | 83.3%   | -    |
| **Algorithmic Schema Pass Rate** | 0.0%     | 100.0%  | -    |
| **Inference Duration (sec)**     | 0.00s    | 8.02s   | -    |
| **Avg Input Tokens**             | 0        | 0       | -    |
| **Avg Output Tokens**            | 0        | 0       | -    |

## ❌ Pytest Unit Test Failures

```
============================= test session starts ==============================
platform linux -- Python 3.13.14, pytest-9.1.1, pluggy-1.6.0
rootdir: /usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52
configfile: pyproject.toml
plugins: asyncio-1.4.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 8 items / 28 errors

==================================== ERRORS ====================================
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py:20: in <module>
    from a2ui.adk.a2a.event_converter import A2uiEventConverter
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py:21: in <module>
    from a2a import types as a2a_types
E   ModuleNotFoundError: No module named 'a2a'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py:18: in <module>
    from google.adk.sessions.session import Session
E   ModuleNotFoundError: No module named 'google'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py:20: in <module>
    from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/elemental/test_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_format.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py:43: in <module>
    import run_compiler
specification/proposals/express/scripts/run_compiler.py:45: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_compiler.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/express/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_integration.py:24: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
__ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/schema/test_utils.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_utils.py:19: in <module>
    from a2ui.core.exceptions import A2uiCatalogError
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/schema/test_validator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
___ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_atom_format.py ____
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/test_atom_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/test_formats.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_formats.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run52/agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py'.
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
============================== 28 errors in 0.43s ==============================

warning: `VIRTUAL_ENV=/usr/local/google/home/gspencer/code/a2ui/atom_format/.venv` does not match the project environment path `.venv` and will be ignored; use `--active` to target the active environment instead
Using CPython 3.13.14 interpreter at: /usr/bin/python3
Creating virtual environment at: .venv
Installed 22 packages in 67ms

```

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index 5d4e0ec2..1801bcf6 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -465,7 +465,10 @@ class AtomCompiler:
             if isinstance(v, list) and v and (isinstance(v[0], list) or self._is_component_type(str(v[0]))):
                 if isinstance(v[0], list) and self._is_component_type(str(v[0][0])):
                     break
-            clean_path = k[2:] if k.startswith("$/") else (k[1:] if k.startswith("$") else k)
+            clean_k = str(k).strip()
+            if clean_k.startswith(":"):
+                clean_k = clean_k[1:]
+            clean_path = clean_k[2:] if clean_k.startswith("$/") else (clean_k[1:] if clean_k.startswith("$") else clean_k)
             clean_path = clean_path.lstrip("/")
             if not clean_path:
                 continue
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
  (Column :id "root"
    :children [
      (data
        $/breeds [
          "https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&q=80&w=300"
          "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&q=80&w=300"
          "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&q=80&w=300"
          "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&q=80&w=300"
        ]
        $/skills_options [
          "Super Jump"
          "Invisibility"
          "Laser Focus"
          "Hyper Bark"
          "Extreme Cuddling"
        ]
        $/generator (:name "" :legs "4" :skills [])
        $/generated_desc "No dog generated yet. Complete the form above and click 'Generate'!"
      )

      (Card :child
        (Column :children [
          (Text :text "Famous Dog breeds" :variant "body")
          (Image :url "https://images.unsplash.com/photo-1534361960057-19889db9621e?auto=format&fit=crop&q=80&w=800" :description "Different dog breeds" :variant "header")
          (List :direction "horizontal" :children
            (template :item breed_url
              (Image :url $/breed_url :variant "smallFeature")
            )
          )
        ])
      )

      (Card :child
        (Column :children [
          (Text :text "Fictional Dog Generator" :variant "body")
          (Text :text "Design your own customized imaginary dog breed by filling out its traits below." :variant "caption")

          (TextField :label "Dog Breed Name" :value $/generator/name :placeholder "e.g., Golden Cosmic Retriever" :variant "shortText")
          (TextField :label "Number of Legs" :value $/generator/legs :placeholder "4" :variant "number")
          (ChoicePicker :label "Skills" :variant "multipleSelection" :options $/skills_options :value $/generator/skills :displayStyle "chips")

          (Button
            :child (Text :text "Generate")
            :variant "primary"
            :action (Event "generate_dog" :name $/generator/name :legs $/generator/legs :skills $/generator/skills)
          )

          (Divider :axis "horizontal")

          (Column :children [
            (Text :text "Generated Dog Profile" :variant "body")
            (Text :text $/generated_desc :variant "caption")
          ])
        ])
      )
    ]
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To evaluate the submitted answer against the specified criterion, let's break down the requirements and compare them to the submission:
  >
  > 1. **Target surfaceId 'main'**:
  >    The submitted JSON contains a command to create/initialize a surface with `"surfaceId": "main"`. This successfully targets the correct surface.
  > 2. **Contain data model updates/population**:
  >    The `createSurface` payload contains a `"dataModel"` field which is used to initialize/populate the data model for the surface 'main'.
  > 3. **Set the data model paths `/user/name` to "John Doe" and `/user/email` to "john.doe@example.com"**:
  >    Within the `"dataModel"` property, the submission has:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This structure correctly resolves to setting `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >
  > The submission meets all components of the criterion perfectly.
  >
  > GRADE: C
