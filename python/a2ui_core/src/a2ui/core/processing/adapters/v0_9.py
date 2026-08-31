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

from typing import Any
from .base import BaseVersionAdapter
from ...schema import ProtocolVersion, AgentToRendererMessagePayload
from ...schema.v0_9 import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
    A2uiMessageListWrapper,
)
from ..operations import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)


class V0Point9Adapter(BaseVersionAdapter):
    """Protocol version adapter for specification v0.9."""

    @property
    def version(self) -> ProtocolVersion:
        return ProtocolVersion.V0_9

    @property
    def supported_versions(self) -> set[str]:
        return {"v0.9", "v0.9.1"}

    def prepare_payload_for_validation(
        self, raw_payload: dict[str, Any]
    ) -> dict[str, Any]:
        payload = dict(raw_payload)
        if payload.get("version") in ("v0.9.1", "0.9.1"):
            payload["version"] = "v0.9"
        return payload

    @property
    def schema(self) -> Any:
        return A2uiMessageListWrapper

    @property
    def valid_actions(self) -> set[str]:
        return {
            MSG_TYPE_CREATE_SURFACE,
            MSG_TYPE_UPDATE_COMPONENTS,
            MSG_TYPE_UPDATE_DATA_MODEL,
            MSG_TYPE_DELETE_SURFACE,
        }

    def _extract_operations_for_action(
        self, action: str, message: dict[str, Any]
    ) -> list[InternalOperation]:
        res: list[InternalOperation] = []
        if action == MSG_TYPE_CREATE_SURFACE:
            cs = message[MSG_TYPE_CREATE_SURFACE]
            res.append(
                InternalCreateSurfaceOp(
                    surface_id=self._get_surface_id(cs),
                    catalog_id=cs.get("catalogId"),
                    theme=cs.get("theme"),
                    send_data_model=bool(cs.get("sendDataModel", False)),
                    components=cs.get("components"),
                    data_model=cs.get("dataModel"),
                )
            )
        elif action == MSG_TYPE_UPDATE_COMPONENTS:
            uc = message[MSG_TYPE_UPDATE_COMPONENTS]
            res.append(
                InternalUpdateComponentsOp(
                    surface_id=self._get_surface_id(uc),
                    components=uc.get("components", []),
                )
            )
        elif action == MSG_TYPE_UPDATE_DATA_MODEL:
            ud = message[MSG_TYPE_UPDATE_DATA_MODEL]
            res.append(
                InternalUpdateDataModelOp(
                    surface_id=self._get_surface_id(ud),
                    path=ud.get("path", "/"),
                    value=ud.get("value"),
                )
            )
        elif action == MSG_TYPE_DELETE_SURFACE:
            ds = message[MSG_TYPE_DELETE_SURFACE]
            res.append(
                InternalDeleteSurfaceOp(
                    surface_id=self._get_surface_id(ds),
                )
            )
        return res
