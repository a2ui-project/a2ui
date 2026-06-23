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

from pathlib import Path

DEFAULT_CATALOG_PATH = "specification/v0_9/catalogs/basic/catalog.json"
DEFAULT_ROLE_DESCRIPTION = "You are an AI assistant. Based on the following request, generate a stream of JSON messages that conform to the provided JSON Schemas."

DEFAULT_WORKFLOW_DESCRIPTION = """
Additional Rules:
1. Generate a 'createSurface' message with surfaceId 'main' and catalogId 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'.
2. Generate a 'updateComponents' message with surfaceId 'main' containing the requested UI.
3. Among the 'updateComponents' messages in the output, there MUST be one root component with id: 'root'.
4. Ensure all component children are referenced by ID, NOT nested inline as objects.
"""
