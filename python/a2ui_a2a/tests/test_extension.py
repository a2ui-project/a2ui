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

"""Tests that the A2A helpers accept every protocol version in every form."""

import json
from pathlib import Path
from unittest.mock import MagicMock

from a2a.server.agent_execution import RequestContext
import jsonschema
import pytest

from a2ui.a2a import (
    A2UI_EXTENSION_BASE_URI,
    A2UI_MIME_TYPE,
    DEPRECATED_A2UI_MIME_TYPE,
    create_a2ui_part,
    get_a2ui_agent_extension,
    get_a2ui_extension_uri,
    try_activate_a2ui_extension,
)
from a2ui.core.schema import ProtocolVersion

# Each protocol version, and the version its extension URI ends in.
VERSIONS = [
    (ProtocolVersion.V0_8, "0.8"),
    (ProtocolVersion.V0_9, "0.9"),
    (ProtocolVersion.V0_9_1, "0.9.1"),
    (ProtocolVersion.V1_0, "1.0"),
]


def _forms(member: ProtocolVersion, bare: str) -> list[ProtocolVersion | str]:
    return [member, member.value, bare]


@pytest.mark.parametrize("member, bare", VERSIONS)
def test_extension_uri_is_the_same_for_every_form(member, bare):
    expected = f"{A2UI_EXTENSION_BASE_URI}/v{bare}"
    for version in _forms(member, bare):
        assert get_a2ui_extension_uri(version) == expected
        assert get_a2ui_agent_extension(version).uri == expected


def test_extension_uri_keeps_versions_this_sdk_does_not_define():
    assert get_a2ui_extension_uri("2.0.0") == f"{A2UI_EXTENSION_BASE_URI}/v2.0.0"


@pytest.mark.parametrize(
    "member, bare, mime_type",
    [
        (ProtocolVersion.V0_8, "0.8", DEPRECATED_A2UI_MIME_TYPE),
        (ProtocolVersion.V0_9, "0.9", DEPRECATED_A2UI_MIME_TYPE),
        (ProtocolVersion.V0_9_1, "0.9.1", A2UI_MIME_TYPE),
        (ProtocolVersion.V1_0, "1.0", A2UI_MIME_TYPE),
    ],
)
def test_part_mime_type_is_the_same_for_every_form(member, bare, mime_type):
    for version in _forms(member, bare):
        part = create_a2ui_part({}, version=version)
        assert part.root.metadata == {"mimeType": mime_type}


def _activate(requested: list[str], advertised: list[str]):
    context = MagicMock(spec=RequestContext)
    context.requested_extensions = requested
    context.message = None
    card = MagicMock()
    card.capabilities.extensions = [MagicMock(uri=uri) for uri in advertised]
    return try_activate_a2ui_extension(context, card), context


@pytest.mark.parametrize("member, bare", VERSIONS)
def test_activation_returns_the_protocol_version(member, bare):
    uri = get_a2ui_extension_uri(member)
    version, context = _activate([uri], [uri])
    assert version is member
    context.add_activated_extension.assert_called_once_with(uri)


def test_activation_picks_the_newest_shared_version():
    uris = [get_a2ui_extension_uri(member) for member, _ in VERSIONS]
    version, _ = _activate(uris, uris[:3])
    assert version is ProtocolVersion.V0_9_1


def test_activation_skips_versions_this_sdk_does_not_define():
    known = get_a2ui_extension_uri(ProtocolVersion.V1_0)
    unknown = get_a2ui_extension_uri("2.0.0")
    version, context = _activate([known, unknown], [known, unknown])
    assert version is ProtocolVersion.V1_0
    context.add_activated_extension.assert_called_once_with(known)


_AGENT_CAPABILITIES_SCHEMA_PATH = (
    Path(__file__).resolve().parents[3]
    / "specification"
    / "v1_0"
    / "json"
    / "agent_capabilities.json"
)


@pytest.mark.parametrize(
    "accepts_inline_catalogs, supported_catalog_ids",
    [
        (False, []),
        (True, []),
        (False, ["a"]),
        (True, ["a", "b"]),
    ],
)
def test_v1_0_params_match_agent_capabilities_schema(
    accepts_inline_catalogs: bool,
    supported_catalog_ids: list[str],
) -> None:
    schema = json.loads(_AGENT_CAPABILITIES_SCHEMA_PATH.read_text(encoding="utf-8"))
    v1_0_schema = dict(schema["properties"]["1.0"])
    if not supported_catalog_ids:
        v1_0_schema.pop("required", None)

    ext = get_a2ui_agent_extension(
        ProtocolVersion.V1_0,
        accepts_inline_catalogs=accepts_inline_catalogs,
        supported_catalog_ids=supported_catalog_ids,
    )
    jsonschema.Draft202012Validator(v1_0_schema).validate(ext.params or {})


@pytest.mark.parametrize(
    "accepts_inline_catalogs, supported_catalog_ids",
    [
        (False, []),
        (True, []),
        (False, ["a"]),
        (True, ["a", "b"]),
    ],
)
def test_v1_0_params_are_not_version_keyed(
    accepts_inline_catalogs: bool,
    supported_catalog_ids: list[str],
) -> None:
    ext = get_a2ui_agent_extension(
        ProtocolVersion.V1_0,
        accepts_inline_catalogs=accepts_inline_catalogs,
        supported_catalog_ids=supported_catalog_ids,
    )
    assert "1.0" not in (ext.params or {})
