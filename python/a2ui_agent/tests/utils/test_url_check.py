# Copyright 2024 Google LLC
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

"""Unit tests for `a2ui.utils.check_payload_urls`."""

import copy
from typing import Any

import pytest

from a2ui.core import (
    AllowlistUrlSecurityPolicy,
    Catalog,
    UrlCheckInfo,
    UrlContext,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.utils import BlockedPayloadUrl, check_payload_urls

_V10_BASIC_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
_V09_BASIC_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
_PRODUCT_ID = "https://example.com/product/catalog.json"
_DYNAMIC_STRING = {"$ref": "common_types.json#/$defs/DynamicString"}

_BASIC_V10 = BasicCatalog("1.0")
_BASIC_V09 = BasicCatalog("0.9")
_CDN_ONLY = AllowlistUrlSecurityPolicy(media=["cdn.example.com"])

_PRODUCT = Catalog.from_json({
    "catalogId": _PRODUCT_ID,
    "protocolVersion": "1.0",
    "components": {
        "ProductCard": {
            "type": "object",
            "properties": {
                "component": {"const": "ProductCard"},
                "title": _DYNAMIC_STRING,
                "imageUrl": {**_DYNAMIC_STRING, "x-a2ui-url-context": "media"},
                "pageUrl": {**_DYNAMIC_STRING, "x-a2ui-url-context": "navigation"},
                "labelUrl": {"type": "string", "x-a2ui-url-context": "none"},
                "gallery": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "thumbnailUrl": {
                                "type": "string",
                                "x-a2ui-url-context": "media",
                            }
                        },
                    },
                },
            },
            "required": ["component"],
        }
    },
})


def _v10(body: dict[str, Any]) -> dict[str, Any]:
    return {"version": "v1.0", **body}


def _create(catalog_id: str, **extra: Any) -> dict[str, Any]:
    return _v10({"createSurface": {"surfaceId": "s", "catalogId": catalog_id, **extra}})


def _update(*components: dict[str, Any]) -> dict[str, Any]:
    return _v10(
        {"updateComponents": {"surfaceId": "s", "components": list(components)}}
    )


def _data(path: str, *value: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"surfaceId": "s", "path": path}
    if value:
        body["value"] = value[0]
    return _v10({"updateDataModel": body})


def test_baseline_only_by_default() -> None:
    payload = [
        _create(_V10_BASIC_ID),
        _update(
            {"id": "root", "component": "Image", "url": "https://any.example/a.png"},
            {"id": "bad", "component": "Image", "url": "javascript:alert(1)"},
        ),
    ]
    result = check_payload_urls([_BASIC_V10], payload)
    assert result.blocked == [
        BlockedPayloadUrl(
            message_index=1,
            surface_id="s",
            property_name="url",
            context="media",
            redacted_url="javascript:",
            catalog_id=_V10_BASIC_ID,
            component_id="bad",
            component_type="Image",
        )
    ]
    assert result.messages[0] is payload[0]
    assert result.messages[1] is payload[1]


def test_basic_media_props_are_checked_and_reports_are_redacted() -> None:
    result = check_payload_urls(
        [_BASIC_V10],
        [
            _create(_V10_BASIC_ID),
            _update(
                {
                    "id": "root",
                    "component": "Image",
                    "url": "https://cdn.example.com/a",
                },
                {
                    "id": "v",
                    "component": "Video",
                    "url": "https://cdn.example.com/v.mp4",
                    "posterUrl": "https://attacker.example/p.png?secret=42",
                },
                {
                    "id": "a",
                    "component": "AudioPlayer",
                    "url": "https://attacker.example/a.mp3",
                },
                {"id": "t", "component": "Text", "text": "https://attacker.example/t"},
            ),
        ],
        policy=_CDN_ONLY,
    )
    assert [
        (b.component_id, b.property_name, b.redacted_url) for b in result.blocked
    ] == [
        ("v", "posterUrl", "https://attacker.example"),
        ("a", "url", "https://attacker.example"),
    ]
    assert "secret" not in repr(result.blocked)


def test_custom_catalog_marks_nested_props_and_none() -> None:
    result = check_payload_urls(
        [_PRODUCT],
        [
            _create(_PRODUCT_ID),
            _update({
                "id": "root",
                "component": "ProductCard",
                "title": "Shoe",
                "imageUrl": "https://attacker.example/i.png",
                "pageUrl": "https://anywhere.example/p",
                "labelUrl": "javascript:not-checked",
                "gallery": [
                    {"thumbnailUrl": "https://cdn.example.com/1.png"},
                    {"thumbnailUrl": "https://attacker.example/2.png"},
                ],
            }),
        ],
        policy=_CDN_ONLY,
    )
    assert [(b.property_name, b.context) for b in result.blocked] == [
        ("imageUrl", "media"),
        ("gallery[].thumbnailUrl", "media"),
    ]


def test_policy_receives_where_the_url_comes_from() -> None:
    calls: list[tuple[str, UrlContext, UrlCheckInfo | None]] = []

    class RecordingPolicy:

        def sanitize_url(
            self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
        ) -> str | None:
            calls.append((url, context, info))
            return url

    check_payload_urls(
        [_PRODUCT],
        [
            _create(_PRODUCT_ID),
            _update({
                "id": "root",
                "component": "ProductCard",
                "pageUrl": "https://shop.example/p",
            }),
        ],
        policy=RecordingPolicy(),
    )
    assert calls == [(
        "https://shop.example/p",
        "navigation",
        UrlCheckInfo(
            surface_id="s",
            catalog_id=_PRODUCT_ID,
            component_type="ProductCard",
            component_id="root",
            property_name="pageUrl",
        ),
    )]


def test_absolute_bindings_use_the_data_the_payload_sets() -> None:
    result = check_payload_urls(
        [_BASIC_V10],
        [
            _create(
                _V10_BASIC_ID,
                dataModel={"photos": {"ok": "https://cdn.example.com/ok.png"}},
            ),
            _data("/photos/leak", "https://attacker.example/?d=secret"),
            _update(
                {"id": "root", "component": "Image", "url": {"@path": "/photos/ok"}},
                {"id": "leak", "component": "Image", "url": {"@path": "/photos/leak"}},
                {"id": "unset", "component": "Image", "url": {"@path": "/nope"}},
                {"id": "relative", "component": "Image", "url": {"@path": "photo"}},
                {
                    "id": "call",
                    "component": "Image",
                    "url": {
                        "@call": "formatString",
                        "args": {"value": "https://attacker.example/${/x}"},
                    },
                },
            ),
        ],
        policy=_CDN_ONLY,
    )
    assert [(b.message_index, b.component_id, b.data_path) for b in result.blocked] == [
        (2, "leak", "/photos/leak")
    ]
    assert result.blocked[0].redacted_url == "https://attacker.example"


@pytest.mark.parametrize(
    "updates, expected",
    [
        ([_data("/photo", "https://attacker.example/")], 1),
        (
            [
                _data("/photo", "https://attacker.example/"),
                _data("/photo", "https://cdn.example.com/"),
            ],
            0,
        ),
        ([_data("/photo", "https://attacker.example/"), _data("/photo")], 0),
        ([_data("/", {"photo": "https://attacker.example/"})], 1),
    ],
)
def test_data_updates_apply_in_order(
    updates: list[dict[str, Any]], expected: int
) -> None:
    image = _update({"id": "root", "component": "Image", "url": {"@path": "/photo"}})
    result = check_payload_urls(
        [_BASIC_V10], [_create(_V10_BASIC_ID), *updates, image], policy=_CDN_ONLY
    )
    assert len(result.blocked) == expected


def test_bindings_read_lists_the_payload_creates_or_updates() -> None:
    result = check_payload_urls(
        [_BASIC_V10],
        [
            _create(
                _V10_BASIC_ID,
                dataModel={"items": [{"url": "https://cdn.example.com/0.png"}]},
            ),
            _data("/items/1/url", "https://attacker.example/"),
            _data("/fresh/0/url", "https://attacker.example/"),
            _update(
                {"id": "root", "component": "Image", "url": {"@path": "/items/0/url"}},
                {
                    "id": "second",
                    "component": "Image",
                    "url": {"@path": "/items/1/url"},
                },
                {"id": "fresh", "component": "Image", "url": {"@path": "/fresh/0/url"}},
            ),
        ],
        policy=_CDN_ONLY,
    )
    assert [b.component_id for b in result.blocked] == ["second", "fresh"]


def test_strip_replaces_blocked_values_in_copies() -> None:
    payload = [
        _create(_V10_BASIC_ID, dataModel={"leak": "https://attacker.example/"}),
        _update(
            {"id": "root", "component": "Image", "url": "https://cdn.example.com/a"},
            {"id": "lit", "component": "Image", "url": "https://attacker.example/a"},
            {"id": "bound", "component": "Image", "url": {"@path": "/leak"}},
        ),
    ]
    before = copy.deepcopy(payload)
    result = check_payload_urls(
        [_BASIC_V10], payload, policy=_CDN_ONLY, on_blocked="strip"
    )
    assert len(result.blocked) == 2
    assert result.messages[0] is payload[0]
    assert result.messages[1] == _update(
        {"id": "root", "component": "Image", "url": "https://cdn.example.com/a"},
        {"id": "lit", "component": "Image", "url": ""},
        {"id": "bound", "component": "Image", "url": ""},
    )
    assert payload == before


def test_strip_nested_values() -> None:
    result = check_payload_urls(
        [_PRODUCT],
        [
            _create(_PRODUCT_ID),
            _update({
                "id": "root",
                "component": "ProductCard",
                "gallery": [
                    {"thumbnailUrl": "https://attacker.example/1.png"},
                    {"thumbnailUrl": "https://cdn.example.com/2.png"},
                ],
            }),
        ],
        policy=_CDN_ONLY,
        on_blocked="strip",
    )
    assert result.messages[1]["updateComponents"]["components"][0]["gallery"] == [
        {"thumbnailUrl": ""},
        {"thumbnailUrl": "https://cdn.example.com/2.png"},
    ]


def test_components_inlined_in_create_surface() -> None:
    result = check_payload_urls(
        [_BASIC_V10],
        [
            _create(
                _V10_BASIC_ID,
                components=[{
                    "id": "root",
                    "component": "Image",
                    "url": "https://attacker.example/a.png",
                }],
            )
        ],
        policy=_CDN_ONLY,
        on_blocked="strip",
    )
    assert [(b.message_index, b.component_id) for b in result.blocked] == [(0, "root")]
    assert result.messages[0]["createSurface"]["components"][0]["url"] == ""


def test_v09_payload_and_theme_icon_url() -> None:
    result = check_payload_urls(
        [_BASIC_V09],
        [
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": "s",
                    "catalogId": _V09_BASIC_ID,
                    "theme": {"iconUrl": "https://attacker.example/icon.png"},
                },
            },
            {
                "version": "v0.9",
                "updateDataModel": {
                    "surfaceId": "s",
                    "path": "/p",
                    "value": "https://attacker.example/x",
                },
            },
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "s",
                    "components": [
                        {"id": "root", "component": "Image", "url": {"path": "/p"}}
                    ],
                },
            },
        ],
        policy=_CDN_ONLY,
        on_blocked="strip",
    )
    assert [
        (b.message_index, b.property_name, b.data_path) for b in result.blocked
    ] == [
        (0, "theme.iconUrl", None),
        (2, "url", "/p"),
    ]
    assert result.messages[0]["createSurface"]["theme"] == {"iconUrl": ""}


def test_host_url_properties_win_over_the_catalog() -> None:
    policy = AllowlistUrlSecurityPolicy(
        media=["cdn.example.com"],
        url_properties={
            _PRODUCT_ID: {"ProductCard": {"title": "media", "imageUrl": "none"}}
        },
    )
    result = check_payload_urls(
        [_PRODUCT],
        [
            _create(_PRODUCT_ID),
            _update({
                "id": "root",
                "component": "ProductCard",
                "title": "https://attacker.example/t.png",
                "imageUrl": "https://attacker.example/i.png",
            }),
        ],
        policy=policy,
    )
    assert [b.property_name for b in result.blocked] == ["title"]


def test_update_only_surface_uses_the_first_catalog_with_the_type() -> None:
    result = check_payload_urls(
        [_PRODUCT, _BASIC_V10],
        _update(
            {"id": "img", "component": "Image", "url": "https://attacker.example/a"}
        ),
        policy=_CDN_ONLY,
    )
    assert [(b.catalog_id, b.component_id) for b in result.blocked] == [
        (_V10_BASIC_ID, "img")
    ]


def test_unknown_messages_and_components_pass_through() -> None:
    payload = [
        _v10({"deleteSurface": {"surfaceId": "s"}}),
        "not a message",
        _update({"id": "x", "component": "Unknown", "url": "javascript:alert(1)"}),
    ]
    result = check_payload_urls([_BASIC_V10], payload, on_blocked="strip")
    assert result.blocked == []
    assert result.messages == payload


def test_a_throwing_policy_blocks() -> None:

    class ThrowingPolicy:

        def sanitize_url(
            self, url: str, context: UrlContext, info: UrlCheckInfo | None = None
        ) -> str | None:
            raise RuntimeError("policy failure")

    result = check_payload_urls(
        [_BASIC_V10],
        [
            _create(_V10_BASIC_ID),
            _update(
                {"id": "root", "component": "Image", "url": "https://cdn.example.com/a"}
            ),
        ],
        policy=ThrowingPolicy(),
    )
    assert len(result.blocked) == 1


def test_rejects_an_unknown_on_blocked_value() -> None:
    with pytest.raises(ValueError, match="on_blocked"):
        check_payload_urls([_BASIC_V10], [], on_blocked="drop")  # type: ignore[arg-type]
