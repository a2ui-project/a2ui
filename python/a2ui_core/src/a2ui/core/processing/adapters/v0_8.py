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
from ...schema import ProtocolVersion
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

    def _extract_operations_for_action(
        self,
        action: str,
        message: dict[str, Any],
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
                    version=message.get("version")
                    or (
                        self.version.value
                        if hasattr(self.version, "value")
                        else str(self.version)
                    ),
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
            raw_path = du.get("path")
            base_path = ""
            if isinstance(raw_path, str):
                stripped = raw_path.strip()
                if stripped and stripped != "/":
                    base_path = (
                        stripped if stripped.startswith("/") else f"/{stripped}"
                    ).rstrip("/")

            def _extract_content_val(entry: dict[str, Any]) -> Any:
                for key in (
                    "valueNumber",
                    "valueString",
                    "valueBoolean",
                    "valueObject",
                    "valueArray",
                ):
                    if key in entry:
                        return entry[key]
                if "valueMap" in entry and isinstance(entry["valueMap"], list):
                    nested: dict[str, Any] = {}
                    for sub in entry["valueMap"]:
                        if isinstance(sub, dict) and isinstance(sub.get("key"), str):
                            nested[sub["key"]] = _extract_content_val(sub)
                    return nested
                return entry.get("value")

            if "contents" in du and isinstance(du["contents"], list):
                for item in du["contents"]:
                    if isinstance(item, dict) and isinstance(item.get("key"), str):
                        item_key = item["key"].lstrip("/")
                        full_path = (
                            (base_path or "/")
                            if item_key in ("", ".")
                            else f"{base_path}/{item_key}"
                        )
                        res.append(
                            InternalUpdateDataModelOp(
                                surface_id=surface_id,
                                path=full_path,
                                value=_extract_content_val(item),
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
