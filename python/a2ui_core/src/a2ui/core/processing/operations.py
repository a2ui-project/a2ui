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

from dataclasses import dataclass, field
from typing import Any

from ..schema.v0_9 import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
)


@dataclass
class InternalCreateSurfaceOp:
    surface_id: str
    catalog_id: str | None = None
    theme: Any | None = None
    send_data_model: bool = False
    components: list[dict[str, Any]] | None = None
    data_model: dict[str, Any] | None = None
    root: str | None = None
    type: str = MSG_TYPE_CREATE_SURFACE


@dataclass
class InternalUpdateComponentsOp:
    surface_id: str
    components: list[dict[str, Any]] = field(default_factory=list)
    type: str = MSG_TYPE_UPDATE_COMPONENTS


@dataclass
class InternalUpdateDataModelOp:
    surface_id: str
    value: Any = None
    path: str | None = "/"
    type: str = MSG_TYPE_UPDATE_DATA_MODEL


@dataclass
class InternalDeleteSurfaceOp:
    surface_id: str
    type: str = MSG_TYPE_DELETE_SURFACE


InternalOperation = (
    InternalCreateSurfaceOp
    | InternalUpdateComponentsOp
    | InternalUpdateDataModelOp
    | InternalDeleteSurfaceOp
)
