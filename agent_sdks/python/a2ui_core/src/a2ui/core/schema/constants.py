# Copyright 2026 Google LLC
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

from typing import Final, Literal, TypeAlias

SPEC_VERSION: Final = "v0.9"
SPEC_VERSION_TYPE: TypeAlias = Literal["v0.9"]
SPEC_BASE_URL = "https://a2ui.org/specification"

MSG_TYPE_CREATE_SURFACE = "createSurface"
MSG_TYPE_UPDATE_COMPONENTS = "updateComponents"
MSG_TYPE_UPDATE_DATA_MODEL = "updateDataModel"
MSG_TYPE_DELETE_SURFACE = "deleteSurface"

CATALOG_COMPONENTS_KEY = "components"
SURFACE_ID_KEY = "surfaceId"
THEME_KEY = "theme"

ROOT_ID = "root"
