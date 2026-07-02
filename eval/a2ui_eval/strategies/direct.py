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

from inspect_ai.solver import Solver, solver, TaskState, Generate
from inspect_ai.model import ChatMessageSystem
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from ..shared.utils import GIT_ROOT, measured_generate


@solver
def a2ui_system_prompt() -> Solver:
  """Solver to inject A2UI schema and catalog into the system prompt using SDK."""

  async def solve(state: TaskState, generate: Generate) -> TaskState:
    catalog_path = state.metadata['catalog']
    resolved_catalog_path = str(GIT_ROOT / catalog_path)

    catalog_config = CatalogConfig.from_path('basic_catalog', resolved_catalog_path)
    manager = A2uiSchemaManager(version='0.9', catalogs=[catalog_config])

    role_description = state.metadata['role_description']
    workflow_description = state.metadata['workflow_description']

    prompt = manager.generate_system_prompt(
        role_description=role_description,
        workflow_description=workflow_description,
        include_schema=True,
    )

    state.messages.insert(0, ChatMessageSystem(content=prompt))
    return state

  return solve


def direct_solver() -> list[Solver]:
  """Returns the solver chain for the 'direct' evaluation strategy."""
  return [a2ui_system_prompt(), measured_generate()]
