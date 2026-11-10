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

"""Conformance runner for the cases of core/url_security_policy.yaml."""

from __future__ import annotations

from collections.abc import Mapping
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import quote

from a2ui.core import (
    AllowlistUrlSecurityPolicy,
    Catalog,
    CatalogApi,
    MessageProcessor,
    MessageProcessorOptions,
    PermissiveUrlSecurityPolicy,
    SurfaceModel,
    UrlCheckInfo,
    UrlContext,
    UrlSecurityPolicy,
    apply_url_security_policy,
)
from a2ui.core.basic_catalog import v0_9, v1_0
from a2ui.core.resolution import ComponentContext, GenericBinder

_CHECK_KEYS = frozenset(
    {"name", "description", "features", "action", "policy", "steps"}
)
_CHECK_STEP_KEYS = frozenset({"url", "context", "expect"})
_POLICY_KEYS = frozenset({
    "type",
    "media",
    "navigation",
    "iframe",
    "allowRelative",
    "allowSvgDataUrls",
    "rewrite",
})
_RESOLUTION_KEYS = frozenset({
    "name",
    "description",
    "features",
    "action",
    "protocolVersion",
    "catalogPaths",
    "catalogs",
    "policy",
    "messages",
    "expect",
    "steps",
})
_RESOLUTION_STEP_KEYS = frozenset({"messages", "dispatchAction", "expect"})
_DISPATCH_KEYS = frozenset({"surfaceId", "componentId", "userActivation"})
_EXPECT_KEYS = frozenset({"components", "openedUrls", "errors"})
_ERROR_KEYS = frozenset({"code", "surfaceId", "message"})

# The characters JavaScript's `encodeURIComponent` leaves alone.
_URI_COMPONENT_SAFE = "-_.!~*'()"


class UnknownUrlPolicyKeyError(AssertionError):
    """Raised when a case has a key this runner does not know."""


def _assert_known_keys(obj: Any, allowed: frozenset[str], where: str) -> None:
    if not isinstance(obj, Mapping):
        return
    for key in obj:
        if key not in allowed:
            raise UnknownUrlPolicyKeyError(f"{where}: unknown key '{key}'")


def _prefix_rewrite(prefix: str) -> Any:
    def rewrite(url: str, context: UrlContext, info: UrlCheckInfo | None) -> str:
        del context, info  # Unused.
        # Only absolute http(s) URLs are proxied; others pass unchanged.
        if re.match(r"^https?://", url, re.IGNORECASE):
            return prefix + quote(url, safe=_URI_COMPONENT_SAFE)
        return url

    return rewrite


def _build_policy(spec: Mapping[str, Any], where: str) -> UrlSecurityPolicy:
    _assert_known_keys(spec, _POLICY_KEYS, f"{where}.policy")
    allow_svg = bool(spec.get("allowSvgDataUrls", False))
    if spec.get("type") == "permissive":
        return PermissiveUrlSecurityPolicy(allow_svg_data_urls=allow_svg)
    assert (
        spec.get("type") == "allowlist"
    ), f"{where}: unknown policy type {spec.get('type')!r}"
    rewrite = {
        context: _prefix_rewrite(hook["prefix"])
        for context, hook in (spec.get("rewrite") or {}).items()
    }
    return AllowlistUrlSecurityPolicy(
        media=spec.get("media"),
        navigation=spec.get("navigation"),
        iframe=spec.get("iframe"),
        allow_relative=spec.get("allowRelative") or (),
        rewrite=rewrite,
        allow_svg_data_urls=allow_svg,
    )


def run_url_policy_check_case(case: dict[str, Any]) -> None:
    """Runs one `url_policy_check` case."""
    name = case.get("name", "")
    _assert_known_keys(case, _CHECK_KEYS, name)
    policy = _build_policy(case["policy"], name)
    for i, step in enumerate(case["steps"]):
        where = f"{name}.steps[{i}]"
        _assert_known_keys(step, _CHECK_STEP_KEYS, where)
        actual = apply_url_security_policy(policy, step["url"], step["context"])
        assert (
            actual == step["expect"]
        ), f"{where}: {step['url']!r} as {step['context']}: got {actual!r}"


def _sdk_catalogs() -> dict[str, CatalogApi]:
    """The basic catalogs the SDK implements, which carry function implementations."""
    catalogs: list[CatalogApi] = [v0_9.BasicCatalog(), v1_0.BasicCatalog()]
    return {catalog.catalog_id: catalog for catalog in catalogs}


def _load_catalogs(case: dict[str, Any], conformance_root: Path) -> list[CatalogApi]:
    version = case.get("protocolVersion")
    documents = [
        json.loads((conformance_root.parent / path).read_text(encoding="utf-8"))
        for path in case.get("catalogPaths") or []
    ] + list(case.get("catalogs") or [])
    sdk = _sdk_catalogs()
    return [
        sdk.get(doc.get("catalogId"))
        or Catalog.from_json(
            doc, protocol_version=doc.get("protocolVersion") or version
        )
        for doc in documents
    ]


def _to_json(value: Any) -> Any:
    """Drops callable and None values, which aren't JSON props."""
    if isinstance(value, list):
        return [_to_json(item) for item in value]
    if isinstance(value, dict):
        return {
            k: _to_json(v)
            for k, v in value.items()
            if not callable(v) and v is not None
        }
    return value


def _assert_matches(actual: Any, expected: Any, where: str) -> None:
    """Checks `actual` against `expected`.

    `None` matches an absent or None value at any depth, objects check only
    the keys `expected` names, lists compare item by item, and everything else
    compares as JSON.
    """
    if expected is None:
        assert actual is None, f"{where}: expected no value, got {actual!r}"
        return
    if isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(
            expected
        ), f"{where}: expected {expected!r}, got {actual!r}"
        for i, (a, e) in enumerate(zip(actual, expected)):
            _assert_matches(a, e, f"{where}[{i}]")
        return
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{where}: expected an object, got {actual!r}"
        for key, value in expected.items():
            _assert_matches(actual.get(key), value, f"{where}.{key}")
        return
    assert actual == expected, f"{where}: expected {expected!r}, got {actual!r}"


class _ResolutionRun:
    """The state of one `url_policy_resolution` case."""

    def __init__(self, case: dict[str, Any], conformance_root: Path) -> None:
        self.name = case.get("name", "")
        self.opened_urls: list[str] = []
        self.errors: list[dict[str, Any]] = []
        self.binders: dict[str, GenericBinder] = {}
        self.processor = MessageProcessor(
            _load_catalogs(case, conformance_root),
            options=MessageProcessorOptions(
                url_security_policy=_build_policy(case["policy"], self.name),
                open_url_handler=lambda url, info: self.opened_urls.append(url),
                report_errors_only=True,
            ),
        )
        self.processor.model.on_surface_created.subscribe(self._watch_surface)

    def _watch_surface(self, surface: SurfaceModel) -> None:
        surface.on_error.subscribe(self.errors.append)

    def _surface_for(self, component_id: str) -> SurfaceModel:
        for surface in self.processor.model.surfaces.values():
            if surface.components_model.get(component_id) is not None:
                return surface
        raise AssertionError(f"{self.name}: no surface has component '{component_id}'")

    def props_of(self, component_id: str) -> Any:
        binder = self.binders.get(component_id)
        if binder is None:
            surface = self._surface_for(component_id)
            binder = GenericBinder(ComponentContext.from_surface(surface, component_id))
            self.binders[component_id] = binder
        return _to_json(binder.snapshot)

    def check(self, expect: dict[str, Any], where: str, after_action: bool) -> None:
        _assert_known_keys(expect, _EXPECT_KEYS, where)
        for component_id, props in (expect.get("components") or {}).items():
            _assert_matches(
                self.props_of(component_id), props, f"{where}.components.{component_id}"
            )
        if not after_action:
            assert (
                "openedUrls" not in expect and "errors" not in expect
            ), f"{where}: openedUrls and errors are only checked after dispatchAction"
            return
        assert self.opened_urls == (
            expect.get("openedUrls") or []
        ), f"{where}.openedUrls: got {self.opened_urls!r}"
        expected_errors = expect.get("errors") or []
        assert len(self.errors) == len(
            expected_errors
        ), f"{where}.errors: got {[e.get('code') for e in self.errors]!r}"
        for i, (actual, expected) in enumerate(zip(self.errors, expected_errors)):
            _assert_known_keys(expected, _ERROR_KEYS, f"{where}.errors[{i}]")
            if "code" in expected:
                assert actual.get("code") == expected["code"], f"{where}.errors[{i}]"
            if "surfaceId" in expected:
                assert (
                    actual.get("surfaceId") == expected["surfaceId"]
                ), f"{where}.errors[{i}]"
            if "message" in expected:
                assert re.search(
                    expected["message"], str(actual.get("message"))
                ), f"{where}.errors[{i}]: {actual.get('message')!r}"

    def dispatch_action(self, dispatch: dict[str, Any], where: str) -> None:
        _assert_known_keys(dispatch, _DISPATCH_KEYS, f"{where}.dispatchAction")
        surface = self.processor.model.get_surface(dispatch["surfaceId"])
        assert surface is not None, f"{where}: no surface '{dispatch['surfaceId']}'"
        context = ComponentContext.from_surface(surface, dispatch["componentId"])
        action = context.component_model.properties.get("action")
        resolved = context.data_context.resolve_action(
            action, is_user_activated=dispatch.get("userActivation", True)
        )
        if isinstance(resolved, dict) and "event" in resolved:
            context.dispatch_action(resolved)

    def dispose(self) -> None:
        for binder in self.binders.values():
            binder.dispose()


def run_url_policy_resolution_case(
    case: dict[str, Any], conformance_root: Path
) -> None:
    """Runs one `url_policy_resolution` case."""
    name = case.get("name", "")
    _assert_known_keys(case, _RESOLUTION_KEYS, name)
    run = _ResolutionRun(case, conformance_root)
    try:
        run.processor.process_messages(case["messages"])
        run.check(case["expect"], f"{name}.expect", after_action=False)
        for i, step in enumerate(case.get("steps") or []):
            where = f"{name}.steps[{i}]"
            _assert_known_keys(step, _RESOLUTION_STEP_KEYS, where)
            assert ("messages" in step) != (
                "dispatchAction" in step
            ), f"{where}: a step has exactly one of messages and dispatchAction"
            run.opened_urls.clear()
            run.errors.clear()
            if "messages" in step:
                run.processor.process_messages(step["messages"])
                run.check(step["expect"], f"{where}.expect", after_action=False)
                continue
            run.dispatch_action(step["dispatchAction"], where)
            run.check(step["expect"], f"{where}.expect", after_action=True)
    finally:
        run.dispose()
