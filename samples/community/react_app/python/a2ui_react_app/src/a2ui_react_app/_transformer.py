# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Catalog and message transformer that checks `ReactApp` components."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping, Sequence
import logging
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion

from ._catalog import REACT_APP_CATALOG_ID, REACT_APP_COMPONENT, react_app_catalog
from ._checks import ReactAppDiagnostic, ReactAppValidationError, check_react_app

logger = logging.getLogger(__name__)

_MAX_TRACKED_SURFACES = 256
_COMPONENT_ENVELOPES = ("createSurface", "updateComponents")


class ReactAppTransformer:
    """Adds the ReactApp catalog to the inference catalogs and checks outbound apps.

    It has the shape of `MacroExpander`, so the two are used the same way:

    1. `transform_catalogs` adds the ReactApp catalog to the app's catalogs
       when it is missing, for the inference format's prompt and parser.
    2. `transform_to_inference_catalog` returns a catalog unchanged: the
       ReactApp catalog is the same for inference and transport.
    3. `transform_to_transport` checks every `ReactApp` component in
       outbound messages (see `check_react_app`) and returns the messages
       unchanged when they pass.
    4. `transform_to_inference` returns the messages unchanged.

    A `ReactApp` component is checked when its `catalogId` is
    `REACT_APP_CATALOG_ID`, or when it has none and its surface's default
    catalog is the ReactApp catalog, has none or isn't known. The transformer
    learns each surface's default catalog from the `createSurface` messages it
    sees, so use one instance per session, or pass `surface_catalogs`.
    """

    def __init__(
        self,
        *,
        on_error: Literal["passthrough", "raise"] = "passthrough",
    ) -> None:
        """Initializes the transformer.

        Args:
            on_error: What `transform_to_transport` does when a component
                fails its checks. `"passthrough"` (the default) logs a warning
                and sends the message anyway, so the renderer shows its error
                card. `"raise"` raises `ReactAppValidationError`, an
                `A2uiValidationError` whose message lists every problem, so an
                agent retry loop can send it back to the model.

        Raises:
            ValueError: If `on_error` is neither `"passthrough"` nor `"raise"`.
        """
        if on_error not in ("passthrough", "raise"):
            raise ValueError(
                f"Invalid on_error policy {on_error!r}; expected 'passthrough' or"
                " 'raise'."
            )
        self.on_error: Literal["passthrough", "raise"] = on_error
        self._surface_catalogs: OrderedDict[str, str | None] = OrderedDict()

    def transform_catalogs(self, catalogs: Sequence[CatalogApi]) -> list[CatalogApi]:
        """Returns the catalogs, with the ReactApp catalog added if it is missing.

        Raises:
            A2uiCatalogError: If a catalog targets a protocol version before
                v1.0, which can't mix catalogs on one surface.
        """
        for catalog in catalogs:
            if catalog.protocol_version and not is_at_least_version(
                catalog.protocol_version, ProtocolVersion.V1_0
            ):
                raise A2uiCatalogError(
                    f"Catalog '{catalog.catalog_id}' targets A2UI"
                    f" v{catalog.protocol_version}, but ReactApp needs v1.0 or"
                    " later, where a surface mixes catalogs."
                )
        out = list(catalogs)
        if not any(c.catalog_id == REACT_APP_CATALOG_ID for c in out):
            out.append(react_app_catalog())
        return out

    def transform_to_inference_catalog(self, catalog: CatalogApi) -> CatalogApi:
        """Returns the catalog unchanged."""
        return catalog

    def transform_to_inference(
        self, messages: Sequence[AgentToRendererMessage]
    ) -> list[AgentToRendererMessage]:
        """Returns the messages unchanged."""
        return list(messages)

    def transform_to_transport(
        self,
        messages: Sequence[AgentToRendererMessage],
        *,
        surface_catalogs: Mapping[str, str | None] | None = None,
    ) -> list[AgentToRendererMessage]:
        """Checks the `ReactApp` components in outbound messages.

        Args:
            messages: The messages to send.
            surface_catalogs: Optional mapping from `surfaceId` to its default
                `catalogId` (or None for a surface without one). When given,
                the surfaces the messages create update a copy of it instead
                of the transformer's own state, so one transformer can serve
                several sessions.

        Returns:
            The messages, unchanged.

        Raises:
            ReactAppValidationError: If `on_error` is `"raise"` and a component
                fails its checks.
        """
        diagnostics = self.check(messages, surface_catalogs=surface_catalogs)
        if diagnostics:
            if self.on_error == "raise":
                raise ReactAppValidationError(diagnostics)
            logger.warning(
                "Sending ReactApp components that failed their checks:\n%s",
                "\n".join(f"- {d.describe()}" for d in diagnostics),
            )
        return list(messages)

    def check(
        self,
        messages: Sequence[AgentToRendererMessage],
        *,
        surface_catalogs: Mapping[str, str | None] | None = None,
    ) -> list[ReactAppDiagnostic]:
        """Returns the problems of every `ReactApp` component in the messages.

        This is what `transform_to_transport` runs, without the `on_error`
        policy, for callers such as a repair loop that want the diagnostics
        as data.

        Args:
            messages: The messages to check.
            surface_catalogs: As in `transform_to_transport`.

        Returns:
            Every problem found, in message and component order.
        """
        surfaces: OrderedDict[str, str | None] = (
            OrderedDict(surface_catalogs)
            if surface_catalogs is not None
            else self._surface_catalogs
        )
        diagnostics: list[ReactAppDiagnostic] = []
        for message in messages:
            msg = message.model_dump(by_alias=True, exclude_none=True)
            self._track_surfaces(msg, surfaces)
            for envelope in _COMPONENT_ENVELOPES:
                body = msg.get(envelope)
                if not isinstance(body, dict):
                    continue
                raw_sid = body.get("surfaceId")
                surface_id = raw_sid if isinstance(raw_sid, str) else None
                components = body.get("components")
                if not isinstance(components, list):
                    continue
                for component in components:
                    if self._owns(component, surface_id, surfaces):
                        diagnostics += check_react_app(component, surface_id=surface_id)
        return diagnostics

    @staticmethod
    def _track_surfaces(
        msg: Mapping[str, Any], surfaces: OrderedDict[str, str | None]
    ) -> None:
        """Records the default catalog of a created surface, and forgets deleted ones."""
        deleted = msg.get("deleteSurface")
        if isinstance(deleted, dict) and isinstance(deleted.get("surfaceId"), str):
            surfaces.pop(deleted["surfaceId"], None)
        created = msg.get("createSurface")
        if not isinstance(created, dict):
            return
        surface_id = created.get("surfaceId")
        if not isinstance(surface_id, str):
            return
        catalog_id = created.get("catalogId")
        surfaces[surface_id] = catalog_id if isinstance(catalog_id, str) else None
        surfaces.move_to_end(surface_id)
        if len(surfaces) > _MAX_TRACKED_SURFACES:
            evicted, _ = surfaces.popitem(last=False)
            logger.warning(
                "Stopped tracking the oldest surface %r (limit=%d)",
                evicted,
                _MAX_TRACKED_SURFACES,
            )

    @staticmethod
    def _owns(
        component: Any,
        surface_id: str | None,
        surfaces: Mapping[str, str | None],
    ) -> bool:
        """Returns whether a component is a `ReactApp` of the ReactApp catalog."""
        if (
            not isinstance(component, dict)
            or component.get("component") != REACT_APP_COMPONENT
        ):
            return False
        catalog_id = component.get("catalogId")
        if catalog_id is not None:
            return bool(catalog_id == REACT_APP_CATALOG_ID)
        if surface_id is None or surface_id not in surfaces:
            return True
        return surfaces[surface_id] in (None, REACT_APP_CATALOG_ID)
