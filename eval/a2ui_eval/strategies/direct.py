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
from ..shared.utils import WORKFLOW_OVERRIDE, measured_generate

@solver
def a2ui_system_prompt(
    schema_path: str, 
    catalog_path: str, 
    role_description: str = "You are an AI assistant. Based on the following request, generate a stream of JSON messages that conform to the provided JSON Schemas."
) -> Solver:
    """Solver to inject A2UI schema and catalog into the system prompt using SDK."""
    catalog_config = CatalogConfig.from_path("basic_catalog", catalog_path)
    manager = A2uiSchemaManager(version="0.9", catalogs=[catalog_config])
    
    prompt = manager.generate_system_prompt(
        role_description=role_description,
        workflow_description=WORKFLOW_OVERRIDE,
        include_schema=True,
    )

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        state.messages.insert(0, ChatMessageSystem(content=prompt))
        return state
        
    return solve

def direct_solver(schema_path: str, catalog_path: str) -> list[Solver]:
    """Returns the solver chain for the 'direct' evaluation strategy."""
    return [
        a2ui_system_prompt(schema_path, catalog_path),
        measured_generate()
    ]
