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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Final, Literal

PROTOCOL_VERSION: Final[Literal["v0.9"]] = "v0.9"
PROTOCOL_VERSION_TYPE = Literal["v0.9"]

ROOT_ID = "root"
CATALOG_COMPONENTS_KEY = "components"
SURFACE_ID_KEY = "surfaceId"
THEME_KEY = "theme"
STYLES_KEY = "styles"
PROTOCOL_BASE_URL = "https://a2ui.org/specification"

# Outbound message types
MSG_TYPE_CREATE_SURFACE = "createSurface"
MSG_TYPE_UPDATE_COMPONENTS = "updateComponents"
MSG_TYPE_UPDATE_DATA_MODEL = "updateDataModel"
MSG_TYPE_DELETE_SURFACE = "deleteSurface"

# Inbound message types
MSG_TYPE_ACTION = "action"
MSG_TYPE_ERROR = "error"
MSG_TYPE_USER_ACTION = MSG_TYPE_ACTION
