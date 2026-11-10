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

"""Python-specific tests of the URL security policy.

The shared rules are covered by conformance/core/url_security_policy.yaml;
these tests cover the Python API around them.
"""

import asyncio
from typing import Any, Literal

from pydantic import Field
import pytest

from a2ui.core import (
    AllowlistUrlSecurityPolicy,
    BASIC_CATALOG_URL_PROPERTIES,
    Catalog,
    DataContext,
    MessageProcessor,
    MessageProcessorOptions,
    PermissiveUrlSecurityPolicy,
    SurfaceModel,
    URL_CONTEXT_KEYWORD,
    UrlCheckInfo,
    UrlContext,
    apply_url_security_policy,
    redact_url,
    url_context_of,
    url_property,
)
from a2ui.core.basic_catalog import v0_9, v1_0
from a2ui.core.catalog import ModelComponentApi
from a2ui.core.resolution import ComponentContext, GenericBinder
from a2ui.core.schema.v1_0.common_types import ComponentCommon, DynamicString

V10_BASIC_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
V09_BASIC_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


class ProductCardComponent(ComponentCommon):
    component: Literal["ProductCard"] = "ProductCard"
    image_url: DynamicString = Field(
        ..., alias="imageUrl", json_schema_extra=url_property("media")
    )
    caption: DynamicString | None = Field(default=None)


def _processor(
    catalogs: list[Any], policy: Any = None, **options: Any
) -> MessageProcessor:
    return MessageProcessor(
        catalogs,
        options=MessageProcessorOptions(url_security_policy=policy, **options),
    )


def _create_surface(
    processor: MessageProcessor,
    catalog_id: str,
    components: list[dict[str, Any]],
    **extra: Any,
) -> SurfaceModel:
    processor.process_messages([{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": catalog_id,
            "components": components,
            **extra,
        },
    }])
    surface = processor.model.get_surface("main")
    assert surface is not None
    return surface


def _props(surface: SurfaceModel, component_id: str) -> dict[str, Any]:
    binder = GenericBinder(ComponentContext.from_surface(surface, component_id))
    return binder.snapshot


def _record_warnings(surface: SurfaceModel) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    surface.on_warning.subscribe(warnings.append)
    return warnings


def test_url_property_returns_the_keyword() -> None:
    assert url_property("media") == {URL_CONTEXT_KEYWORD: "media"}
    assert url_property("none") == {"x-a2ui-url-context": "none"}
    assert url_context_of({"x-a2ui-url-context": "iframe"}) == "iframe"
    assert url_context_of({"x-a2ui-url-context": "bogus"}) is None


def test_url_property_rejects_unknown_contexts() -> None:
    with pytest.raises(ValueError, match="Unknown URL context"):
        url_property("script")  # type: ignore[arg-type]


def test_pydantic_component_marked_with_url_property_is_filtered() -> None:
    catalog = Catalog(
        catalog_id="https://example.com/products.json",
        protocol_version="1.0",
        components=[ModelComponentApi(ProductCardComponent)],
    )
    processor = _processor(
        [catalog], AllowlistUrlSecurityPolicy(media=["cdn.example.com"])
    )
    surface = _create_surface(
        processor,
        catalog.catalog_id,
        [
            {
                "id": "root",
                "component": "ProductCard",
                "imageUrl": "https://evil.example/a",
            },
        ],
    )
    props = _props(surface, "root")
    assert props["imageUrl"] is None


def test_basic_components_are_filtered_in_a_catalog_with_another_id() -> None:
    basic = v1_0.BasicCatalog()
    catalog = Catalog(
        catalog_id="https://example.com/mine.json",
        protocol_version="1.0",
        components=list(basic.components.values()),
    )
    processor = _processor(
        [catalog], AllowlistUrlSecurityPolicy(media=["cdn.example.com"])
    )
    surface = _create_surface(
        processor,
        catalog.catalog_id,
        [{"id": "root", "component": "Image", "url": "https://evil.example/a.png"}],
    )
    assert _props(surface, "root")["url"] is None


def test_host_url_properties_win_over_the_built_in_list() -> None:
    policy = AllowlistUrlSecurityPolicy(
        media=["cdn.example.com"],
        url_properties={V10_BASIC_ID: {"Image": {"url": "none"}}},
    )
    processor = _processor([v1_0.BasicCatalog()], policy)
    surface = _create_surface(
        processor,
        V10_BASIC_ID,
        [{"id": "root", "component": "Image", "url": "https://evil.example/a.png"}],
    )
    assert _props(surface, "root")["url"] == "https://evil.example/a.png"


def test_host_url_properties_mark_props_of_unannotated_catalogs() -> None:
    catalog = Catalog.from_json({
        "catalogId": "https://maps.example.com/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "MapTile": {
                "type": "object",
                "properties": {
                    "component": {"const": "MapTile"},
                    "tileUrl": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component"],
            }
        },
    })
    policy = AllowlistUrlSecurityPolicy(
        media=["tiles.example.com"],
        url_properties={catalog.catalog_id: {"MapTile": {"tileUrl": "media"}}},
    )
    processor = _processor([catalog], policy)
    surface = _create_surface(
        processor,
        catalog.catalog_id,
        [{
            "id": "root",
            "component": "MapTile",
            "tileUrl": {"@path": "/tile"},
        }],
        dataModel={"tile": "https://evil.example/t.png"},
    )
    assert _props(surface, "root")["tileUrl"] is None


def test_blocked_url_is_reported_once_and_redacted() -> None:
    processor = _processor(
        [v1_0.BasicCatalog()], AllowlistUrlSecurityPolicy(media=["cdn.example.com"])
    )
    surface = _create_surface(
        processor,
        V10_BASIC_ID,
        [{
            "id": "root",
            "component": "Image",
            "url": "https://user:pw@evil.example:8443/a.png?d=secret#frag",
        }],
    )
    warnings = _record_warnings(surface)
    _props(surface, "root")
    _props(surface, "root")
    assert len(warnings) == 1
    warning = warnings[0]
    assert warning["code"] == "URL_BLOCKED"
    assert warning["redactedUrl"] == "https://evil.example:8443"
    assert warning["context"] == "media"
    assert warning["surfaceId"] == "main"
    assert warning["componentId"] == "root"
    assert warning["componentType"] == "Image"
    assert warning["propertyName"] == "url"
    assert "secret" not in str(warning) and "pw" not in str(warning)


def test_reported_blocked_urls_are_bounded() -> None:
    surface = SurfaceModel("s", None, protocol_version="1.0")
    warnings = _record_warnings(surface)
    first = "javascript:alert(0)"
    surface.sanitize_url(first, "navigation")
    for i in range(1, 257):
        surface.sanitize_url(f"javascript:alert({i})", "navigation")
    assert len(warnings) == 257
    # The first report was evicted, so it is reported again.
    surface.sanitize_url(first, "navigation")
    assert len(warnings) == 258


def test_non_string_urls_are_blocked_and_reported_once() -> None:
    surface = SurfaceModel("s", None, protocol_version="1.0")
    warnings = _record_warnings(surface)
    for _ in range(2):
        assert surface.sanitize_url(["a"], "media") is None  # type: ignore[arg-type]
        assert surface.sanitize_url({"u": 1}, "media") is None  # type: ignore[arg-type]
    assert [w["redactedUrl"] for w in warnings] == ["invalid", "invalid"]


def test_data_bound_non_string_url_is_blocked() -> None:
    processor = _processor([v1_0.BasicCatalog()], AllowlistUrlSecurityPolicy())
    surface = _create_surface(
        processor,
        V10_BASIC_ID,
        [{"id": "root", "component": "Image", "url": {"@path": "/img"}}],
        dataModel={"img": ["https://cdn.example.com/a.png"]},
    )
    warnings = _record_warnings(surface)
    assert _props(surface, "root").get("url") is None
    assert (
        ComponentContext.from_surface(surface, "root").sanitize_url(
            ["x"], "media"  # type: ignore[arg-type]
        )
        is None
    )
    assert DataContext(surface).sanitize_url({}, "media") is None  # type: ignore[arg-type]
    assert all(w["redactedUrl"] == "invalid" for w in warnings)


def test_component_context_fills_in_where_the_url_comes_from() -> None:
    seen: list[UrlCheckInfo | None] = []

    class RecordingPolicy:

        def sanitize_url(
            self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
        ) -> str | None:
            seen.append(info)
            return url

    processor = _processor([v1_0.BasicCatalog()], RecordingPolicy())
    surface = _create_surface(
        processor,
        V10_BASIC_ID,
        [{"id": "root", "component": "Text", "text": "hi"}],
    )
    context = ComponentContext.from_surface(surface, "root")
    assert (
        context.sanitize_url(
            "https://a.example/x", "navigation", UrlCheckInfo(property_name="text")
        )
        == "https://a.example/x"
    )
    assert seen[-1] == UrlCheckInfo(
        surface_id="main",
        catalog_id=V10_BASIC_ID,
        component_type="Text",
        component_id="root",
        property_name="text",
    )


def test_data_context_without_a_policy_aware_surface_uses_the_baseline() -> None:
    class LegacySurface:
        data_model = None

    context = DataContext(LegacySurface())  # type: ignore[arg-type]
    assert context.sanitize_url("https://a.example/", "media") == "https://a.example/"
    assert context.sanitize_url("javascript:alert(1)", "navigation") is None


def test_a_policy_that_raises_blocks_the_url() -> None:
    class BrokenPolicy:

        def sanitize_url(
            self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
        ) -> str | None:
            raise RuntimeError("boom")

    assert (
        apply_url_security_policy(BrokenPolicy(), "https://a.example/", "media") is None
    )


def test_a_policy_returning_a_non_string_blocks_the_url() -> None:
    class OddPolicy:

        def sanitize_url(self, url: str, context: UrlContext, info: Any = None) -> Any:
            return 42

    assert apply_url_security_policy(OddPolicy(), "https://a.example/", "media") is None


def test_unknown_contexts_raise() -> None:
    surface = SurfaceModel("s", None, protocol_version="1.0")
    with pytest.raises(ValueError, match="Unknown URL context"):
        surface.sanitize_url("https://a.example/", "script")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "hosts",
    [["https://cdn.example.com"], ["cdn.example.com/path"], ["*"], [""], [42]],
)
def test_allowlist_rejects_invalid_host_entries(hosts: list[Any]) -> None:
    with pytest.raises(ValueError, match="Invalid media host entry"):
        AllowlistUrlSecurityPolicy(media=hosts)


def test_allowlist_rejects_a_string_host_list() -> None:
    with pytest.raises(ValueError, match="must be a list"):
        AllowlistUrlSecurityPolicy(media="cdn.example.com")


def test_allowlist_rejects_unknown_contexts() -> None:
    with pytest.raises(ValueError, match="Unknown URL context"):
        AllowlistUrlSecurityPolicy(allow_relative=["script"])  # type: ignore[list-item]
    with pytest.raises(ValueError, match="Unknown URL context"):
        AllowlistUrlSecurityPolicy(rewrite={"script": lambda u, c, i: u})  # type: ignore[dict-item]


def test_allowlist_normalizes_unicode_and_percent_encoded_hosts() -> None:
    policy = AllowlistUrlSecurityPolicy(media=["bücher.example", "cdn.example.com"])
    assert apply_url_security_policy(policy, "https://xn--bcher-kva.example/a", "media")
    assert apply_url_security_policy(policy, "https://cdn%2Eexample.com/a", "media")
    assert apply_url_security_policy(policy, "https://cdn.example.com./a", "media")


def test_redact_url_forms() -> None:
    assert redact_url("https://CDN.example.com:443/a?q=1") == "https://cdn.example.com"
    assert redact_url("http://[::1]:8080/a") == "http://[::1]:8080"
    assert redact_url("data:IMAGE/PNG;base64,AAAA") == "data:image/png"
    assert redact_url("data:,hello") == "data:"
    assert redact_url("https:evil.example/a") == "https:"
    assert redact_url("/a/b?secret=1") == "relative"
    assert redact_url("javascript:alert(1)") == "javascript:"


def test_basic_catalog_url_properties_cover_both_basic_catalogs() -> None:
    for catalog_id in (V09_BASIC_ID, V10_BASIC_ID):
        assert BASIC_CATALOG_URL_PROPERTIES[catalog_id]["Video"] == {
            "url": "media",
            "posterUrl": "media",
        }


@pytest.mark.parametrize(
    ("policy", "expected_theme", "warning_count"),
    [
        (AllowlistUrlSecurityPolicy(media=["cdn.example.com"]), {}, 1),
        (
            AllowlistUrlSecurityPolicy(
                rewrite={"media": lambda url, context, info: "https://proxy.example/i"}
            ),
            {"iconUrl": "https://proxy.example/i"},
            0,
        ),
        (PermissiveUrlSecurityPolicy(), {"iconUrl": "https://evil.example/i.png"}, 0),
    ],
)
def test_v09_theme_icon_url_goes_through_the_policy(
    policy: Any, expected_theme: dict[str, Any], warning_count: int
) -> None:
    warnings: list[dict[str, Any]] = []
    processor = MessageProcessor(
        [v0_9.BasicCatalog()],
        options=MessageProcessorOptions(url_security_policy=policy),
    )
    processor.model.on_surface_created.subscribe(
        lambda surface: surface.on_warning.subscribe(warnings.append)
    )
    processor.process_messages([{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": V09_BASIC_ID,
            "theme": {"iconUrl": "https://evil.example/i.png"},
        },
    }])
    surface = processor.model.get_surface("main")
    assert surface is not None
    assert surface.theme == expected_theme
    assert len(warnings) == warning_count


def _open_url_surface(handler: Any) -> SurfaceModel:
    processor = _processor(
        [v1_0.BasicCatalog()],
        AllowlistUrlSecurityPolicy(navigation=["*.example.com"]),
        open_url_handler=handler,
    )
    return _create_surface(
        processor,
        V10_BASIC_ID,
        [{"id": "root", "component": "Text", "text": "hi"}],
    )


def test_open_url_passes_allowed_urls_and_info_to_the_handler() -> None:
    calls: list[tuple[str, UrlCheckInfo]] = []
    surface = _open_url_surface(lambda url, info: calls.append((url, info)))
    DataContext(surface).resolve_action({
        "functionCall": {"call": "openUrl", "args": {"url": "https://a.example.com/p"}}
    })
    assert calls == [(
        "https://a.example.com/p",
        UrlCheckInfo(surface_id="main", function_name="openUrl"),
    )]


def test_open_url_runs_an_async_handler_on_the_running_loop() -> None:
    opened: list[str] = []

    async def handler(url: str, info: UrlCheckInfo) -> None:
        await asyncio.sleep(0)
        opened.append(url)

    async def main() -> None:
        surface = _open_url_surface(handler)
        DataContext(surface).resolve_action({
            "functionCall": {
                "call": "openUrl",
                "args": {"url": "https://a.example.com/p"},
            }
        })
        assert not opened
        await asyncio.sleep(0.01)

    asyncio.run(main())
    assert opened == ["https://a.example.com/p"]
