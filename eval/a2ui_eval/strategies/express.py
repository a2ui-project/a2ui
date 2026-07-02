# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import os
import re

os.environ["A2UI_EXPRESS_ENABLED"] = "true"
from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import ChatMessageSystem, ModelOutput, ChatCompletionChoice, ChatMessageAssistant, ChatMessageUser
from a2ui.core.catalog import Catalog
from a2ui.experimental.express.prompt_generator import ExpressPromptGenerator
from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.parser import parse_express_response
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from ..shared.utils import GIT_ROOT, measured_generate


@solver
def a2ui_express_prompt() -> Solver:
  """Solver to inject A2UI Express prompt contract instructions."""

  async def solve(state: TaskState, generate: Generate) -> TaskState:
    catalog_path = state.metadata["catalog"]
    resolved_catalog_path = str(GIT_ROOT / catalog_path)
    with open(resolved_catalog_path, "r", encoding="utf-8") as f:
      schema = json.load(f)
    catalog = Catalog.from_json(schema, spec_version="0.9.1")
    generator = ExpressPromptGenerator(catalog)
    prompt = generator.generate_prompt()
    state.messages.insert(0, ChatMessageSystem(content=prompt))
    return state

  return solve


@solver
def compile_express_dsl() -> Solver:
  """Solver to compile generated A2UI Express DSL back to standard JSON."""

  async def solve(state: TaskState, generate: Generate) -> TaskState:
    if not state.output or not state.output.completion:
      return state

    catalog_path = state.metadata["catalog"]
    resolved_catalog_path = str(GIT_ROOT / catalog_path)

    # Initialize the catalog schema validator for parsing
    catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
    manager = A2uiSchemaManager(version="1.0", catalogs=[catalog_config])
    catalog = manager.get_selected_catalog()
    validator = catalog.validator

    completion = state.output.completion.strip()

    # Try to extract target surface ID from the prompt input
    prompt_text = state.input_text
    surface_id_match = re.search(
        r"surface(?:Id|\s+Id)?(?:\s+of)?\s+['\"]([^'\"]+)['\"]",
        prompt_text,
        re.IGNORECASE,
    )
    surface_id = surface_id_match.group(1) if surface_id_match else "main"

    try:
      # 1. Parse and compile DSL to JSON
      parts = parse_express_response(completion, catalog, surface_id=surface_id)
      compiled_json = None
      for p in parts:
        if p.a2ui_json:
          compiled_json = (
              p.a2ui_json[0] if isinstance(p.a2ui_json, list) else p.a2ui_json
          )
          break

      if not compiled_json:
        raise ValueError(
            "No compiled A2UI Express DSL JSON payload found in parsed parts."
        )

      # 2. Validate using catalog schema validator (runs integrity checker too)
      validator.validate([compiled_json])

      # 3. Successful compilation and validation: format and yield
      messages = [compiled_json]
      formatted = f"<a2ui-json>\n{json.dumps(messages, indent=2)}\n</a2ui-json>"
      state.output = ModelOutput(
          model=state.output.model,
          choices=[
              ChatCompletionChoice(message=ChatMessageAssistant(content=formatted))
          ],
      )

    except Exception as e:
      state.output = ModelOutput(
          model=state.output.model,
          choices=[
              ChatCompletionChoice(
                  message=ChatMessageAssistant(
                      content=(
                          f"Compilation/validation failed: {e}\nRaw"
                          f" output:\n{completion}"
                      )
                  )
              )
          ],
      )

    return state

  return solve


def express_solver() -> list[Solver]:
  """Returns the solver chain for the 'express' evaluation strategy."""
  return [a2ui_express_prompt(), measured_generate(), compile_express_dsl()]
