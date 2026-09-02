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
from ...exceptions import A2uiValidationError
from .base import BaseVersionAdapter
from ...schema import ProtocolVersion
from ...schema.v1_0 import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
    MSG_TYPE_CALL_RENDERER_FUNCTION,
    MSG_TYPE_AGENT_FUNCTION_RESPONSE,
    AgentFunctionResponseMessage,
    AgentToRendererMessageListWrapper,
    CallRendererFunction,
)
from ..operations import (
    InternalAgentFunctionResponseOp,
    InternalCallRendererFunctionOp,
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)


from ..execution_context import ExecutionContext


class V1Point0Adapter(BaseVersionAdapter):
    """Protocol version adapter for specification v1.0."""

    @property
    def version(self) -> ProtocolVersion:
        return ProtocolVersion.V1_0

    @property
    def schema(self) -> Any:
        return AgentToRendererMessageListWrapper

    @property
    def valid_actions(self) -> set[str]:
        return {
            MSG_TYPE_CREATE_SURFACE,
            MSG_TYPE_UPDATE_COMPONENTS,
            MSG_TYPE_UPDATE_DATA_MODEL,
            MSG_TYPE_DELETE_SURFACE,
            MSG_TYPE_CALL_RENDERER_FUNCTION,
            MSG_TYPE_AGENT_FUNCTION_RESPONSE,
        }

    def _extract_operations_for_action(
        self,
        action: str,
        message: dict[str, Any],
        context: ExecutionContext | None = None,
    ) -> list[InternalOperation]:
        user_activation = (
            context.user_activation_present if context is not None else False
        )
        res: list[InternalOperation] = []
        if action == MSG_TYPE_CREATE_SURFACE:
            cs = message[MSG_TYPE_CREATE_SURFACE]
            res.append(
                InternalCreateSurfaceOp(
                    surface_id=self._get_surface_id(cs),
                    catalog_id=cs.get("catalogId"),
                    theme=cs.get("theme"),
                    send_data_model=bool(cs.get("sendDataModel", False)),
                )
            )
            comps = cs.get("components")
            if comps is not None:
                res.append(
                    InternalUpdateComponentsOp(
                        surface_id=self._get_surface_id(cs),
                        components=comps,
                    )
                )
            dm = cs.get("dataModel")
            if dm is not None:
                res.append(
                    InternalUpdateDataModelOp(
                        surface_id=self._get_surface_id(cs),
                        path="/",
                        value=dm,
                    )
                )
        elif action == MSG_TYPE_UPDATE_COMPONENTS:
            uc = message[MSG_TYPE_UPDATE_COMPONENTS]
            res.append(
                InternalUpdateComponentsOp(
                    surface_id=self._get_surface_id(uc),
                    components=uc.get("components") or [],
                )
            )
        elif action == MSG_TYPE_UPDATE_DATA_MODEL:
            udm = message[MSG_TYPE_UPDATE_DATA_MODEL]
            res.append(
                InternalUpdateDataModelOp(
                    surface_id=self._get_surface_id(udm),
                    path=udm.get("path") or "/",
                    value=udm.get("value"),
                )
            )
        elif action == MSG_TYPE_DELETE_SURFACE:
            ds = message[MSG_TYPE_DELETE_SURFACE]
            res.append(
                InternalDeleteSurfaceOp(
                    surface_id=self._get_surface_id(ds),
                )
            )
        elif action == MSG_TYPE_CALL_RENDERER_FUNCTION:
            crf = CallRendererFunction.model_validate(
                message[MSG_TYPE_CALL_RENDERER_FUNCTION]
            )
            cf = crf.call_function
            ver_str = (
                self.version.value
                if hasattr(self.version, "value")
                else str(self.version)
            )
            res.append(
                InternalCallRendererFunctionOp(
                    function_call_id=crf.function_call_id,
                    call=cf.call,
                    version=ver_str,
                    catalog_id=cf.catalog_id,
                    args=cf.args or {},
                    user_activation_present=user_activation,
                )
            )
        elif action == MSG_TYPE_AGENT_FUNCTION_RESPONSE:
            af_resp = AgentFunctionResponseMessage.model_validate(message)
            resp_data = af_resp.agent_function_response
            res.append(
                InternalAgentFunctionResponseOp(
                    function_call_id=resp_data.function_call_id,
                    value=resp_data.value,
                    error=resp_data.error.model_dump(by_alias=True)
                    if resp_data.error
                    else None,
                )
            )
        return res
