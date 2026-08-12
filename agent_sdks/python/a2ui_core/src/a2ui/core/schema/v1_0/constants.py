# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Global specification constants for A2UI v1.0 schemas."""

from typing import Final, TypeAlias

VERSION_1_0: Final = "v1.0"
SPEC_VERSION: Final = "v1.0"
SPEC_VERSION_TYPE: TypeAlias = str
SPEC_BASE_URL: Final = "https://a2ui.org/specification"

MSG_TYPE_CREATE_SURFACE: Final = "createSurface"
MSG_TYPE_UPDATE_COMPONENTS: Final = "updateComponents"
MSG_TYPE_UPDATE_DATA_MODEL: Final = "updateDataModel"
MSG_TYPE_DELETE_SURFACE: Final = "deleteSurface"
MSG_TYPE_CALL_RENDERER_FUNCTION: Final = "callRendererFunction"
MSG_TYPE_AGENT_FUNCTION_RESPONSE: Final = "agentFunctionResponse"
MSG_TYPE_ACTION: Final = "action"
MSG_TYPE_CALL_AGENT_FUNCTION: Final = "callAgentFunction"
MSG_TYPE_RENDERER_FUNCTION_RESPONSE: Final = "rendererFunctionResponse"
MSG_TYPE_ERROR: Final = "error"

CATALOG_COMPONENTS_KEY: Final = "components"
SURFACE_ID_KEY: Final = "surfaceId"
THEME_KEY: Final = "theme"
SURFACE_PROPERTIES_KEY: Final = "surfaceProperties"

ROOT_ID: Final = "root"
