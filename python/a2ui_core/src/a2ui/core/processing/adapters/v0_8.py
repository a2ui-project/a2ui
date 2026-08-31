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
from ...schema.v0_8 import (
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_DATA_MODEL_UPDATE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_SURFACE_UPDATE,
    A2uiMessageListWrapper,
)
from ..operations import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)


class V0Point8Adapter(BaseVersionAdapter):
    """Protocol version adapter for specification v0.8."""

    @property
    def version(self) -> ProtocolVersion:
        return ProtocolVersion.V0_8

    @property
    def schema(self) -> Any:
        return A2uiMessageListWrapper

    @property
    def valid_actions(self) -> set[str]:
        return {
            MSG_TYPE_BEGIN_RENDERING,
            MSG_TYPE_SURFACE_UPDATE,
            MSG_TYPE_DATA_MODEL_UPDATE,
            MSG_TYPE_DELETE_SURFACE,
        }

    @property
    def raise_on_empty_actions(self) -> bool:
        return False

    def _extract_operations_for_action(
        self, action: str, message: dict[str, Any]
    ) -> list[InternalOperation]:
        res: list[InternalOperation] = []
        if action == MSG_TYPE_BEGIN_RENDERING:
            br = message[MSG_TYPE_BEGIN_RENDERING]
            res.append(
                InternalCreateSurfaceOp(
                    surface_id=self._get_surface_id(br),
                    catalog_id=br.get("catalogId"),
                    theme=br.get("theme") or br.get("styles"),
                    send_data_model=bool(br.get("sendDataModel", False)),
                    components=br.get("components"),
                    data_model=br.get("dataModel"),
                    root=br.get("root"),
                )
            )
        elif action == MSG_TYPE_SURFACE_UPDATE:
            su = message[MSG_TYPE_SURFACE_UPDATE]
            raw_comps = su.get("components")
            if not isinstance(raw_comps, list):
                raw_comps = []
            norm_comps: list[dict[str, Any]] = []
            for c in raw_comps:
                if isinstance(c, dict):
                    c_id = c.get("id")
                    c_comp = c.get("component")
                    comp_item: dict[str, Any] = {"id": c_id}
                    if isinstance(c_comp, dict) and c_comp:
                        comp_type = next(iter(c_comp.keys()))
                        comp_item["component"] = comp_type
                        props = c_comp[comp_type]
                        if isinstance(props, dict):
                            comp_item.update(props)
                    elif isinstance(c_comp, str):
                        comp_item["component"] = c_comp
                        comp_item.update(
                            {k: v for k, v in c.items() if k not in ("id", "component")}
                        )
                    else:
                        comp_item.update(
                            {k: v for k, v in c.items() if k not in ("id", "component")}
                        )
                    norm_comps.append(comp_item)
            res.append(
                InternalUpdateComponentsOp(
                    surface_id=self._get_surface_id(su),
                    components=norm_comps,
                )
            )
        elif action == MSG_TYPE_DATA_MODEL_UPDATE:
            du = message[MSG_TYPE_DATA_MODEL_UPDATE]
            surface_id = self._get_surface_id(du)
            if "contents" in du and isinstance(du["contents"], list):
                for item in du["contents"]:
                    if isinstance(item, dict) and "key" in item:
                        key = item["key"]
                        val = None
                        for k, v in item.items():
                            if k.startswith("value"):
                                val = v
                                break
                        res.append(
                            InternalUpdateDataModelOp(
                                surface_id=surface_id,
                                path=f"/{key}",
                                value=val,
                            )
                        )
            else:
                res.append(
                    InternalUpdateDataModelOp(
                        surface_id=surface_id,
                        path=du.get("path", "/"),
                        value=du.get("value"),
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
