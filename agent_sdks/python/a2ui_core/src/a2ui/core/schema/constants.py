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

"""Global specification constants and protocol versions for A2UI schemas."""

from enum import Enum
from typing import Final, TypeAlias


class A2uiProtocolVersion(str, Enum):
    """Enumeration of supported A2UI protocol versions."""

    V0_8 = "v0.8"
    V0_9 = "v0.9"
    V0_9_1 = "v0.9.1"
    V1_0 = "v1.0"


SPEC_VERSION: Final = "v0.9"
SPEC_VERSION_TYPE: TypeAlias = str
SPEC_BASE_URL: Final = "https://a2ui.org/specification"

MSG_TYPE_CREATE_SURFACE: Final = "createSurface"
MSG_TYPE_UPDATE_COMPONENTS: Final = "updateComponents"
MSG_TYPE_UPDATE_DATA_MODEL: Final = "updateDataModel"
MSG_TYPE_DELETE_SURFACE: Final = "deleteSurface"

CATALOG_COMPONENTS_KEY: Final = "components"
SURFACE_ID_KEY: Final = "surfaceId"
THEME_KEY: Final = "theme"

ROOT_ID: Final = "root"
