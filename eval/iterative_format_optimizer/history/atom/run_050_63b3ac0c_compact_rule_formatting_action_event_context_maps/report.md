# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | PASS     | FAIL    | -    |
| **Overall Pass Rate**            | 0.0%     | 83.3%   | -    |
| **Algorithmic Schema Pass Rate** | 0.0%     | 100.0%  | -    |
| **Inference Duration (sec)**     | 0.00s    | 10.17s  | -    |
| **Avg Input Tokens**             | 0        | 0       | -    |
| **Avg Output Tokens**            | 0        | 0       | -    |

## ❌ Pytest Unit Test Failures

```
============================= test session starts ==============================
platform linux -- Python 3.13.14, pytest-9.1.1, pluggy-1.6.0
rootdir: /usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50
configfile: pyproject.toml
plugins: asyncio-1.4.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 8 items / 28 errors

==================================== ERRORS ====================================
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_event_converter.py:20: in <module>
    from a2ui.adk.a2a.event_converter import A2uiEventConverter
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/a2a/test_part_converter.py:21: in <module>
    from a2a import types as a2a_types
E   ModuleNotFoundError: No module named 'a2a'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/orchestration/test_a2ui_subagent_map.py:18: in <module>
    from google.adk.sessions.session import Session
E   ModuleNotFoundError: No module named 'google'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/adk/test_send_a2ui_to_client_toolset.py:20: in <module>
    from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_a2a_integration.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_adk_extensions.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/conformance/test_conformance.py:16: in <module>
    import yaml
E   ModuleNotFoundError: No module named 'yaml'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_compiler.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/elemental/test_format.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_format.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_integration.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_parser_decompile.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/elemental/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
E   ModuleNotFoundError: No module named 'a2ui'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_cli_tools.py:43: in <module>
    import run_compiler
specification/proposals/express/scripts/run_compiler.py:45: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_compiler.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_compiler.py:21: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_integration.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/express/test_integration.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_integration.py:24: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_parser_decompile.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/express/test_prompt_generator.py:21: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v08.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/parser/test_streaming_v09.py:27: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
__ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_catalog.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/schema/test_transport_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/schema/test_utils.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_utils.py:19: in <module>
    from a2ui.core.exceptions import A2uiCatalogError
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/schema/test_validator.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/schema/test_validator_v10.py:18: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
___ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_atom_format.py ____
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/test_atom_format.py'.
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
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/test_formats.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_formats.py:16: in <module>
    from a2ui.schema.catalog import A2uiCatalog
agent_sdks/python/a2ui_agent/src/a2ui/schema/catalog.py:26: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py __
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
agent_sdks/python/a2ui_agent/tests/test_prompt_examples.py:20: in <module>
    from a2ui.core.catalog import Catalog
E   ModuleNotFoundError: No module named 'a2ui.core'
_ ERROR collecting agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py _
ImportError while importing test module '/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-atom-run50/agent_sdks/python/a2ui_agent/tests/test_specification_roundtrip.py'.
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
Installed 22 packages in 71ms

```

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 252fb518..431a8431 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -55,7 +55,7 @@ You MUST surround the entire A2UI Atom block with sentinel tags `<a2ui>` and `</
    - List templates use (template :item item (ChildComponent $/item/name)) or (ListComponent :children (template :item item (ChildComponent $/item/name))).

 8. Action Events:
-   - Actions use (Event "action_name" :param1 $/value). Interactive controls with action attributes MUST provide an action expression, e.g., (ActionComponent :child (ChildComponent "Text") :action (Event "click_action")).
+   - Actions use (Event "action_name" :param1 $/value) or (Event "action_name"). Omit context parameters when parameterless. Interactive controls with action attributes MUST provide an action expression.

 9. Standalone Operations:
    - Delete surface: (deleteSurface "surface_id")
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
    :id "root"
    (data
      $/breeds [
        (:url "https://images.dog.ceo/breeds/retriever-golden/n02099601_3004.jpg")
        (:url "https://images.dog.ceo/breeds/poodle-standard/n02113799_2280.jpg")
        (:url "https://images.dog.ceo/breeds/husky/n02110185_10121.jpg")
        (:url "https://images.dog.ceo/breeds/corgi-cardigan/n02113158_1157.jpg")
      ]
      $/generator/name ""
      $/generator/legs 4
      $/generator/skills []
      $/generator/result "Fill out the form above and click Generate to create your custom dog!"
    )
    (Card
      :child (Column
        (Text :text "Famous Dog breeds" :variant "body")
        (Image :url "https://images.dog.ceo/breeds/husky/n02110185_10121.jpg" :variant "header")
        (List
          :direction "horizontal"
          :children (template :item breed
            (Image :url $/breed/url :variant "smallFeature")
          )
        )
      )
    )
    (Card
      :child (Column
        (Text :text "Fictional Dog Generator" :variant "body")
        (Text :text "Enter some details to generate your own custom, fictional dog breed!" :variant "caption")
        (TextField :label "Dog breed name" :placeholder "e.g. Cyber-Pug" :value $/generator/name :variant "shortText")
        (TextField :label "Number of legs" :placeholder "4" :value $/generator/legs :variant "number")
        (ChoicePicker
          :label "Skills"
          :variant "multipleSelection"
          :options ["Super Speed" "Invisibility" "Laser Eyes" "Flight" "Extreme Cuteness"]
          :value $/generator/skills
          :displayStyle "chips"
        )
        (Button
          :variant "primary"
          :action (Event "generate_dog")
          :child (Text :text "Generate")
        )
        (Divider :axis "horizontal")
        (Column
          (Text :text "Generated Dog Description" :variant "body")
          (Text :text $/generator/result :variant "caption")
        )
      )
    )
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To determine if the submission meets the criterion, let's break down the requirements step by step:
  >
  > 1. **Target surfaceId 'main'**: The submission initiates a `createSurface` operation where the `surfaceId` is set to `"main"`. This successfully targets the required surface.
  > 2. **Contain data model updates**: In the payload, the `"dataModel"` property is populated within the `createSurface` action, which handles initializing and setting the client's data model state.
  > 3. **Set the paths `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`**: Under the `"dataModel"` object, the structure provided is:
  >    ```json
  >    "user": {
  >      "name": "John Doe",
  >      "email": "john.doe@example.com"
  >    }
  >    ```
  >    This corresponds directly to setting the data model paths `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >
  > The submission successfully meets all parts of the criterion.
  >
  > GRADE: C
