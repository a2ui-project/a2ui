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

"""Catalog and message transformer that checks and compiles `ReactApp` components."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping, Sequence
import copy
from dataclasses import dataclass, field
import functools
import logging
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats import to_message_models

from ._bindings import ReactAppBindings
from ._catalog import REACT_APP_CATALOG_ID, REACT_APP_COMPONENT, react_app_catalog
from ._checks import ReactAppDiagnostic, ReactAppValidationError, check_react_app
from ._compiler import CompileDiagnostic, CompileResult, ReactAppCompiler
from ._schema_ts import callable_by_default, function_definitions
from ._source import A2UI_MODULE_EXPORTS, ReactAppSourceFacts, react_app_source_facts

logger = logging.getLogger(__name__)

_MAX_TRACKED_SURFACES = 256
_COMPONENT_ENVELOPES = ("createSurface", "updateComponents")


@functools.cache
def _component_properties() -> frozenset[str]:
    """The properties the ReactApp catalog declares for the component."""
    schema = react_app_catalog().to_json()["components"][REACT_APP_COMPONENT]
    return frozenset(schema.get("properties") or {})


def _derived_allowlists(facts: ReactAppSourceFacts) -> dict[str, list[str] | None]:
    """The allowlists the source implies; None where it uses computed names."""
    return {
        "dataPaths": None if facts.dynamic_paths else sorted(facts.paths),
        "functions": (
            None
            if facts.dynamic_functions
            else sorted(facts.called_functions - set(A2UI_MODULE_EXPORTS))
        ),
        "actions": None if facts.dynamic_actions else sorted(facts.actions),
    }


def compile_diagnostic(
    diagnostic: CompileDiagnostic,
    *,
    component_id: str | None,
    surface_id: str | None,
) -> ReactAppDiagnostic:
    """Turns a compiler diagnostic into a `ReactAppDiagnostic` on `source`."""
    return ReactAppDiagnostic(
        code="compile_error" if diagnostic.phase == "transpile" else "type_error",
        message=(
            f"line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}"
        ),
        property_name="source",
        component_id=component_id,
        surface_id=surface_id,
    )


@dataclass(frozen=True)
class ReactAppCompile:
    """The compile of one `ReactApp` component by `ReactAppTransformer`.

    Attributes:
        component_id: The component's `id`.
        surface_id: The surface it is on.
        source: The source that was compiled.
        result: The compiler's result, with timings.
        diagnostics: The problems that count under the transformer's
            `type_errors` policy.
    """

    component_id: str | None
    surface_id: str | None
    source: str
    result: CompileResult
    diagnostics: tuple[ReactAppDiagnostic, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.diagnostics


@dataclass
class ReactAppTransportResult:
    """What `ReactAppTransformer.process` returns."""

    messages: list[AgentToRendererMessage]
    diagnostics: list[ReactAppDiagnostic] = field(default_factory=list)
    compiles: list[ReactAppCompile] = field(default_factory=list)


class ReactAppTransformer:
    """Adds the ReactApp catalog to the inference catalogs and checks outbound apps.

    It has the shape of `MacroExpander`, so the two are used the same way:

    1. `transform_catalogs` adds the ReactApp catalog to the app's catalogs
       when it is missing, for the inference format's prompt and parser.
    2. `transform_to_inference_catalog` returns a catalog unchanged: the
       ReactApp catalog is the same for inference and transport.
    3. `transform_to_transport` strips any model-supplied `compiled`, fills in
       missing allowlists (`dataPaths`, `functions`, `actions`) when the
       source names everything with string literals, and checks every
       `ReactApp` component (see `check_react_app`). With a `compiler`, it
       also transpiles and type-checks each app that passes the structural
       checks and fills in `compiled`, so the frame skips its own transpile.
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
        compiler: ReactAppCompiler | None = None,
        bindings: ReactAppBindings | None = None,
        type_errors: Literal["error", "warning"] = "error",
    ) -> None:
        """Initializes the transformer.

        Args:
            on_error: What `transform_to_transport` does when a component
                fails its checks. `"passthrough"` (the default) logs a warning
                and sends the message anyway, so the renderer shows its error
                card. `"raise"` raises `ReactAppValidationError`, an
                `A2uiValidationError` whose message lists every problem, so an
                agent retry loop can send it back to the model.
            compiler: Compiles and type-checks each app that passes the
                structural checks, and fills in `compiled`. Without one, apps
                are only checked structurally and the frame transpiles them.
            bindings: Declarations of the `a2ui:bindings` module
                (`react_app_bindings`), passed to `compiler` so bound function
                calls are type-checked.
            type_errors: Whether type errors fail the check (`"error"`, the
                default) or are only logged (`"warning"`, while still setting
                `compiled`). Transpile errors always fail the check.

        Raises:
            ValueError: If `on_error` or `type_errors` is invalid.
        """
        if on_error not in ("passthrough", "raise"):
            raise ValueError(
                f"Invalid on_error policy {on_error!r}; expected 'passthrough' or"
                " 'raise'."
            )
        if type_errors not in ("error", "warning"):
            raise ValueError(
                f"Invalid type_errors policy {type_errors!r}; expected 'error' or"
                " 'warning'."
            )
        self.on_error: Literal["passthrough", "raise"] = on_error
        self.compiler = compiler
        self.bindings = bindings
        self.type_errors: Literal["error", "warning"] = type_errors
        self._surface_catalogs: OrderedDict[str, str | None] = OrderedDict()
        self._functions: frozenset[str] | None = None

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
        # The functions an app may call, for the outbound checks.
        self._functions = frozenset(
            name for name, d in function_definitions(out) if callable_by_default(d)
        )
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
        """Checks and compiles the outbound `ReactApp` components.

        Args:
            messages: The messages to send.
            surface_catalogs: Optional mapping from `surfaceId` to its default
                `catalogId` (or None for a surface without one). When given,
                the surfaces the messages create update a copy of it instead
                of the transformer's own state, so one transformer can serve
                several sessions.

        Returns:
            The messages, with allowlists and `compiled` filled in where
            applicable, and any model-supplied `compiled` stripped.

        Raises:
            ReactAppValidationError: If `on_error` is `"raise"` and a component
                fails its checks (a worker failure logs and ships without
                `compiled` instead of raising).
        """
        result = self.process(messages, surface_catalogs=surface_catalogs)
        actionable = [d for d in result.diagnostics if d.code != "compile_unavailable"]
        if actionable:
            if self.on_error == "raise":
                raise ReactAppValidationError(actionable)
            logger.warning(
                "Sending ReactApp components that failed their checks:\n%s",
                "\n".join(f"- {d.describe()}" for d in actionable),
            )
        return result.messages

    def check(
        self,
        messages: Sequence[AgentToRendererMessage],
        *,
        surface_catalogs: Mapping[str, str | None] | None = None,
    ) -> list[ReactAppDiagnostic]:
        """Returns the problems of every `ReactApp` component in the messages.

        This is what `transform_to_transport` runs, allowlists filled in, but
        without the `on_error` policy, for callers such as a repair loop that
        want the diagnostics as data.

        Args:
            messages: The messages to check.
            surface_catalogs: As in `transform_to_transport`.

        Returns:
            Every problem found, in message and component order.
        """
        return self.process(messages, surface_catalogs=surface_catalogs).diagnostics

    def process(
        self,
        messages: Sequence[AgentToRendererMessage],
        *,
        surface_catalogs: Mapping[str, str | None] | None = None,
    ) -> ReactAppTransportResult:
        """Runs the structural checks and, when configured, the compiler.

        Any `compiled` present on an owned component is stripped first, so a
        model cannot inject pre-compiled code and running the transformer
        twice is idempotent. If the compile worker fails on a component, the
        failure is logged, recorded as a `compile_unavailable` diagnostic, and
        the component ships without `compiled` so the frame transpiles it.

        Args:
            messages: The messages to process.
            surface_catalogs: As in `transform_to_transport`.

        Returns:
            The transformed messages, the diagnostics, and one
            `ReactAppCompile` per compiled component.
        """
        surfaces: OrderedDict[str, str | None] = (
            OrderedDict(surface_catalogs)
            if surface_catalogs is not None
            else self._surface_catalogs
        )
        out: list[AgentToRendererMessage] = []
        diagnostics: list[ReactAppDiagnostic] = []
        compiles: list[ReactAppCompile] = []
        for message in messages:
            msg = message.model_dump(by_alias=True, exclude_none=True)
            self._track_surfaces(msg, surfaces)
            changed = False
            for envelope in _COMPONENT_ENVELOPES:
                body = msg.get(envelope)
                if not isinstance(body, dict):
                    continue
                raw_sid = body.get("surfaceId")
                surface_id = raw_sid if isinstance(raw_sid, str) else None
                components = body.get("components")
                if not isinstance(components, list):
                    continue
                for index, component in enumerate(components):
                    if not self._owns(component, surface_id, surfaces):
                        continue
                    if "compiled" in component:
                        component = {
                            k: v for k, v in component.items() if k != "compiled"
                        }
                        components[index] = component
                        changed = True
                    completed = self._fill_allowlists(component)
                    if completed is not component:
                        component = completed
                        components[index] = component
                        changed = True
                    found = check_react_app(
                        component, surface_id=surface_id, functions=self._functions
                    )
                    diagnostics += found
                    if found or self.compiler is None:
                        continue
                    compiled = self._compile(component, surface_id)
                    compiles.append(compiled)
                    diagnostics += compiled.diagnostics
                    if compiled.result.compiled is not None:
                        component["compiled"] = compiled.result.compiled
                        changed = True
            out.append(to_message_models([msg])[0] if changed else message)
        return ReactAppTransportResult(
            messages=out, diagnostics=diagnostics, compiles=compiles
        )

    def _compile(
        self, component: dict[str, Any], surface_id: str | None
    ) -> ReactAppCompile:
        assert self.compiler is not None
        raw_id = component.get("id")
        component_id = raw_id if isinstance(raw_id, str) else None
        source = str(component.get("source") or "")
        bindings_dts = (
            self.bindings.declarations
            if self.bindings is not None and self.bindings.names
            else None
        )
        try:
            result = self.compiler.compile(source, bindings=bindings_dts)
        except (RuntimeError, OSError) as exc:
            logger.warning(
                "ReactApp %r could not be compiled on the server (%s); sending"
                " without compiled so the frame transpiles it.",
                component_id,
                exc,
            )
            unavailable = ReactAppDiagnostic(
                code="compile_unavailable",
                message=str(exc),
                property_name="source",
                component_id=component_id,
                surface_id=surface_id,
            )
            return ReactAppCompile(
                component_id=component_id,
                surface_id=surface_id,
                source=source,
                result=CompileResult(ok=False, compiled=None),
                diagnostics=(unavailable,),
            )
        diagnostics = [
            compile_diagnostic(d, component_id=component_id, surface_id=surface_id)
            for d in result.diagnostics
            if d.phase == "transpile" or self.type_errors == "error"
        ]
        if self.type_errors == "warning" and any(
            d.phase == "type" for d in result.diagnostics
        ):
            logger.warning(
                "ReactApp '%s' has type errors:\n%s",
                component_id,
                "\n".join(d.describe() for d in result.diagnostics),
            )
        return ReactAppCompile(
            component_id=component_id,
            surface_id=surface_id,
            source=source,
            result=result,
            diagnostics=tuple(diagnostics),
        )

    @staticmethod
    def _fill_allowlists(component: dict[str, Any]) -> dict[str, Any]:
        """Returns the component with its missing allowlists filled in, if any were.

        A list is filled only when the source uses something it would allow
        and names everything it uses with string literals; otherwise the
        check reports a list the app needs as missing.
        """
        source = component.get("source")
        if not isinstance(source, str):
            return component
        declared = _component_properties()
        missing = [
            prop
            for prop in ("dataPaths", "functions", "actions")
            if prop in declared and prop not in component
        ]
        if not missing:
            return component
        derived = _derived_allowlists(react_app_source_facts(source))
        # A missing list already means an empty one to the surface.
        additions: dict[str, Any] = {
            prop: derived[prop] for prop in missing if derived[prop]
        }
        if not additions:
            return component
        logger.info(
            "Filled in the allowlists of ReactApp %r from its source: %s",
            component.get("id"),
            additions,
        )
        return {**copy.deepcopy(component), **additions}

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
