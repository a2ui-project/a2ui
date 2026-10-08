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

"""Unit tests for `a2ui.utils.validate_payload`."""

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, A2uiIntegrityError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.utils import validate_payload

_BASIC = BasicCatalog("0.9")
_COLUMN = {"id": "root", "component": "Column", "children": ["t"]}
_TEXT = {"id": "t", "component": "Text", "text": "Hi"}

_V08_BEGIN = {"beginRendering": {"surfaceId": "s", "root": "root"}}
_V08_COLUMN = {
    "id": "root",
    "component": {"Column": {"children": {"explicitList": ["t"]}}},
}
_V08_TEXT = {"id": "t", "component": {"Text": {"text": {"literalString": "Hi"}}}}


def _create(catalog_id: str, version: str = "v0.9") -> dict[str, Any]:
    return {
        "version": version,
        "createSurface": {"surfaceId": "s", "catalogId": catalog_id},
    }


def _update(*components: dict[str, Any], version: str = "v0.9") -> dict[str, Any]:
    return {
        "version": version,
        "updateComponents": {"surfaceId": "s", "components": list(components)},
    }


def _v08_update(*components: dict[str, Any]) -> dict[str, Any]:
    return {"surfaceUpdate": {"surfaceId": "s", "components": list(components)}}


def _catalog(
    catalog_id: str, *components: str, protocol_version: str = "0.9"
) -> Catalog:
    """Returns a catalog whose components each require a `text` string."""
    return Catalog.from_json(
        {
            "catalogId": catalog_id,
            "components": {
                name: {
                    "type": "object",
                    "properties": {
                        "component": {"const": name},
                        "text": {"type": "string"},
                    },
                    "required": ["component", "text"],
                }
                for name in components
            },
        },
        protocol_version=protocol_version,
    )


def test_created_surface_with_a_complete_tree_is_accepted():
    validate_payload([_BASIC], [_create(_BASIC.catalog_id), _update(_COLUMN, _TEXT)])


def test_created_surface_rejects_a_dangling_reference():
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        validate_payload([_BASIC], [_create(_BASIC.catalog_id), _update(_COLUMN)])


def test_created_surface_requires_a_root():
    with pytest.raises(A2uiIntegrityError, match="Missing root component"):
        validate_payload([_BASIC], [_create(_BASIC.catalog_id), _update(_TEXT)])


def test_updated_surface_accepts_references_to_earlier_components():
    validate_payload([_BASIC], [_update(_COLUMN)])


def test_updated_surface_rejects_an_unknown_component():
    with pytest.raises(
        A2uiValidationError, match="Unrecognized component type 'Unknown'"
    ):
        validate_payload([_BASIC], [_update({"id": "x", "component": "Unknown"})])


def test_updated_surface_rejects_an_invalid_component():
    with pytest.raises(A2uiValidationError, match="'text' is a required property"):
        validate_payload([_BASIC], [_update({"id": "t", "component": "Text"})])


def test_single_message_is_accepted():
    validate_payload([_BASIC], _update(_TEXT))


def test_empty_payload_is_accepted():
    validate_payload([_BASIC], [])


@pytest.mark.parametrize(
    "extra_action",
    [
        {"updateComponents": {"surfaceId": "s", "components": [_TEXT]}},
        {"deleteSurface": {"surfaceId": "s"}},
    ],
)
def test_message_with_several_actions_is_rejected(extra_action):
    message = {**_create(_BASIC.catalog_id), **extra_action}

    with pytest.raises(A2uiValidationError, match="multiple conflicting"):
        validate_payload([_BASIC], [message, _update(_COLUMN, _TEXT)])


def test_message_that_is_not_an_object_is_rejected():
    with pytest.raises(A2uiValidationError, match="Message 1 is not a JSON object"):
        validate_payload([_BASIC], [_update(_TEXT), "text"])


def test_message_without_a_version_is_rejected():
    message = _update(_TEXT)
    del message["version"]

    with pytest.raises(A2uiValidationError, match="Message 0 states no version"):
        validate_payload([_BASIC], [message])


@pytest.mark.parametrize("version", ["V0.9", "0.9", "v0.9.0", 0.9, "v1.0"])
def test_message_with_another_version_is_rejected(version):
    with pytest.raises(A2uiValidationError, match="Message 0 states version"):
        validate_payload([_BASIC], [_update(_TEXT, version=version)])


@pytest.mark.parametrize("protocol_version", ["0.9", "0.9.1"])
@pytest.mark.parametrize("version", ["v0.9", "v0.9.1"])
def test_v0_9_and_v0_9_1_catalogs_accept_either_version(protocol_version, version):
    catalog = _catalog("a", "Text", protocol_version=protocol_version)

    validate_payload(
        [catalog],
        [
            _create("a", version=version),
            _update({"id": "root", "component": "Text", "text": "Hi"}, version=version),
        ],
    )


def test_v0_9_1_basic_catalog_accepts_v0_9_1_messages():
    catalog = BasicCatalog("0.9.1")

    validate_payload(
        [catalog],
        [
            _create(catalog.catalog_id, version="v0.9.1"),
            _update(_COLUMN, _TEXT, version="v0.9.1"),
        ],
    )


def test_v1_0_catalogs_accept_v1_0_messages():
    catalog = BasicCatalog("1.0")

    validate_payload(
        [catalog],
        [
            _create(catalog.catalog_id, version="v1.0"),
            _update(_COLUMN, _TEXT, version="v1.0"),
        ],
    )


def test_v1_0_catalogs_reject_v0_9_messages():
    message = {"version": "v0.9", "deleteSurface": {"surfaceId": "s"}}

    with pytest.raises(A2uiValidationError, match="states version 'v0.9'"):
        validate_payload([BasicCatalog("1.0")], [message])


def test_v0_8_payload_is_accepted():
    validate_payload(
        [BasicCatalog("0.8")], [_V08_BEGIN, _v08_update(_V08_COLUMN, _V08_TEXT)]
    )


def test_v0_8_updates_may_precede_begin_rendering():
    validate_payload(
        [BasicCatalog("0.8")], [_v08_update(_V08_COLUMN, _V08_TEXT), _V08_BEGIN]
    )


def test_v0_8_created_surface_rejects_a_dangling_reference():
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        validate_payload([BasicCatalog("0.8")], [_V08_BEGIN, _v08_update(_V08_COLUMN)])


def test_v0_8_message_that_states_a_version_is_rejected():
    with pytest.raises(A2uiValidationError, match="Message 0 states a version"):
        validate_payload(
            [BasicCatalog("0.8")],
            [{"version": "v0.8", **_V08_BEGIN}, _v08_update(_V08_COLUMN, _V08_TEXT)],
        )


def test_v0_8_updated_surface_accepts_references_to_earlier_components():
    validate_payload([BasicCatalog("0.8")], [_v08_update(_V08_COLUMN)])


def test_v0_8_updated_surface_rejects_an_unknown_component():
    with pytest.raises(
        A2uiValidationError, match="Unrecognized component type 'Unknown'"
    ):
        validate_payload(
            [BasicCatalog("0.8")],
            [_v08_update({"id": "x", "component": {"Unknown": {}}})],
        )


def test_created_surface_uses_the_catalog_it_names():
    catalogs = [_catalog("a", "Text"), _catalog("b", "Card")]
    card = {"id": "root", "component": "Card", "text": "Hi"}

    validate_payload(catalogs, [_create("b"), _update(card)])
    with pytest.raises(A2uiValidationError, match="Unrecognized component type 'Card'"):
        validate_payload(catalogs, [_create("a"), _update(card)])


def test_updated_surface_uses_a_catalog_that_defines_its_components():
    catalogs = [_catalog("a", "Text"), _catalog("b", "Card")]

    validate_payload(
        catalogs, [_update({"id": "c", "component": "Card", "text": "Hi"})]
    )


def test_updated_surface_reports_the_error_from_a_catalog_that_defines_it():
    # Only "a" defines Text, so its error is raised rather than the unknown
    # component error from "b", which comes first.
    catalogs = [_catalog("b", "Card"), _catalog("a", "Text")]

    with pytest.raises(A2uiValidationError, match="'text' is a required property"):
        validate_payload(catalogs, [_update({"id": "t", "component": "Text"})])


def test_updated_surface_that_no_catalog_defines_is_checked_against_the_first():
    catalogs = [_catalog("a", "Text"), _catalog("b", "Card")]
    components = [
        {"id": "c", "component": "Card", "text": "Hi"},
        {"id": "t", "component": "Text", "text": "Hi"},
    ]

    with pytest.raises(A2uiValidationError, match="Unrecognized component type 'Card'"):
        validate_payload(catalogs, [_update(*components)])


def test_component_that_names_its_catalog_does_not_choose_the_surface_catalog():
    catalogs = [
        _catalog("a", "Text", protocol_version="1.0"),
        _catalog("b", "Card", protocol_version="1.0"),
    ]
    components = [
        {"id": "c", "component": "Card", "text": "Hi", "catalogId": "b"},
        {"id": "t", "component": "Text", "text": "Hi"},
    ]

    validate_payload(catalogs, [_update(*components, version="v1.0")])


def test_surface_on_a_catalog_that_is_not_held_is_a_validation_error():
    with pytest.raises(A2uiValidationError, match="Catalog not found: missing"):
        validate_payload([_BASIC], [_create("missing")])


def test_v0_9_and_v0_9_1_catalogs_can_be_combined():
    catalogs = [_BASIC, _catalog("a", "Text", protocol_version="0.9.1")]

    validate_payload(
        catalogs,
        [
            _create("a", version="v0.9.1"),
            _update(
                {"id": "root", "component": "Text", "text": "Hi"}, version="v0.9.1"
            ),
        ],
    )


def test_no_catalogs_is_a_catalog_error():
    with pytest.raises(A2uiCatalogError, match="at least one catalog"):
        validate_payload([], [])


def test_catalogs_of_incompatible_versions_are_a_catalog_error():
    with pytest.raises(A2uiCatalogError, match="incompatible protocol versions"):
        validate_payload([_BASIC, BasicCatalog("1.0")], [])


def test_full_v0_9_flow_on_the_basic_catalog_is_accepted():
    surface = "contact-card"
    payload = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": surface, "catalogId": _BASIC.catalog_id},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": surface,
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["avatar", "name", "email", "submit"],
                    },
                    {"id": "avatar", "component": "Image", "url": {"path": "/image"}},
                    {"id": "name", "component": "Text", "text": {"path": "/name"}},
                    {
                        "id": "email",
                        "component": "TextField",
                        "label": "Email",
                        "value": {"path": "/email"},
                    },
                    {
                        "id": "submit",
                        "component": "Button",
                        "child": "submit_label",
                        "action": {"event": {"name": "submit"}},
                    },
                    {"id": "submit_label", "component": "Text", "text": "Send"},
                ],
            },
        },
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": surface,
                "path": "/",
                "value": {"name": "Ada", "email": "ada@example.com", "image": "a.png"},
            },
        },
        {"version": "v0.9", "deleteSurface": {"surfaceId": surface}},
    ]

    validate_payload([_BASIC], payload)


def test_full_v0_8_flow_on_the_basic_catalog_is_accepted():
    surface = "contact-card"
    payload = [
        {"beginRendering": {"surfaceId": surface, "root": "root"}},
        {
            "surfaceUpdate": {
                "surfaceId": surface,
                "components": [
                    {
                        "id": "root",
                        "component": {
                            "Column": {
                                "children": {
                                    "explicitList": ["profile_image", "info_row"]
                                }
                            }
                        },
                    },
                    {
                        "id": "profile_image",
                        "component": {
                            "Image": {"url": {"path": "/image"}, "usageHint": "avatar"}
                        },
                    },
                    {
                        "id": "info_row",
                        "component": {
                            "Row": {"children": {"explicitList": ["icon", "name"]}}
                        },
                    },
                    {
                        "id": "icon",
                        "component": {"Icon": {"name": {"literalString": "mail"}}},
                    },
                    {
                        "id": "name",
                        "component": {
                            "Text": {"text": {"path": "/name"}, "usageHint": "h2"}
                        },
                    },
                ],
            }
        },
        {
            "dataModelUpdate": {
                "surfaceId": surface,
                "contents": [
                    {"key": "name", "valueString": "Ada"},
                    {"key": "image", "valueString": "a.png"},
                ],
            }
        },
        {"deleteSurface": {"surfaceId": surface}},
    ]

    validate_payload([BasicCatalog("0.8")], payload)


def test_updated_surface_with_a_known_catalog_is_checked_against_it_only():
    catalogs = [_catalog("a", "Text"), _catalog("b", "Text", "Card")]
    components = [{"id": "c", "component": "Card", "text": "Hi"}]

    validate_payload(catalogs, [_update(*components)])
    with pytest.raises(A2uiValidationError, match="Unrecognized component type 'Card'"):
        validate_payload(
            catalogs, [_update(*components)], surface_catalog_ids={"s": "a"}
        )


def test_updated_surface_on_a_known_catalog_that_is_not_held_is_rejected():
    with pytest.raises(A2uiValidationError, match="isn't one of the active catalogs"):
        validate_payload(
            [_catalog("a", "Text")],
            [_update({"id": "t", "component": "Text", "text": "Hi"})],
            surface_catalog_ids={"s": "missing"},
        )


def test_created_surface_ignores_its_known_catalog():
    catalogs = [_catalog("a", "Text"), _catalog("b", "Card")]

    validate_payload(
        catalogs,
        [_create("b"), _update({"id": "root", "component": "Card", "text": "Hi"})],
        surface_catalog_ids={"s": "a"},
    )


def test_typed_schema_models_are_accepted():
    from a2ui.core.schema import v0_8, v0_9

    wrapper = v0_9.A2uiMessageListWrapper.model_validate({"messages": [_update(_TEXT)]})
    msg = wrapper.messages[0]

    validate_payload([_BASIC], msg)
    validate_payload([_BASIC], [msg])
    validate_payload([_BASIC], wrapper)

    v08_wrapper = v0_8.A2uiMessageListWrapper.model_validate(
        {"messages": [_v08_update(_V08_TEXT)]}
    )
    v08_msg = v08_wrapper.messages[0]
    v08_basic = BasicCatalog("0.8")

    validate_payload([v08_basic], v08_msg)
    validate_payload([v08_basic], [v08_msg])
    validate_payload([v08_basic], v08_wrapper)

    null_data_wrapper = v0_9.A2uiMessageListWrapper.model_validate({
        "messages": [{
            "version": "v0.9",
            "updateDataModel": {"surfaceId": "s", "path": "/user", "value": None},
        }]
    })
    validate_payload([_BASIC], null_data_wrapper.messages[0])
