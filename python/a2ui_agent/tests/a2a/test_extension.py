# Copyright 2026 Google LLC
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

"""Unit tests for a2ui.a2a.extension helpers (a2a-sdk 0.3 / 1.x)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from a2ui.a2a.extension import (
    get_a2ui_agent_extension,
    get_a2ui_extension_uri,
    try_activate_a2ui_extension,
)


def test_get_a2ui_agent_extension_params():
    ext = get_a2ui_agent_extension(
        "0.9",
        accepts_inline_catalogs=True,
        supported_catalog_ids=[
            "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        ],
    )
    assert ext.uri == get_a2ui_extension_uri("0.9")
    params = dict(ext.params) if ext.params is not None else {}
    assert params.get("acceptsInlineCatalogs") is True
    assert params.get("supportedCatalogIds") == [
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    ]


def test_try_activate_records_on_add_activated_extension():
    context = MagicMock()
    context.requested_extensions = [get_a2ui_extension_uri("0.9")]
    context.message = None
    context.add_activated_extension = MagicMock()

    card = MagicMock()
    ext = MagicMock()
    ext.uri = get_a2ui_extension_uri("0.9")
    card.capabilities.extensions = [ext]

    version = try_activate_a2ui_extension(context, card)
    assert version == "0.9"
    context.add_activated_extension.assert_called_once_with(
        get_a2ui_extension_uri("0.9")
    )


def test_try_activate_falls_back_to_call_context_state():
    uri = get_a2ui_extension_uri("0.9")
    state = {}
    context = SimpleNamespace(
        requested_extensions=[uri],
        message=None,
        call_context=SimpleNamespace(state=state),
    )
    card = MagicMock()
    ext = MagicMock()
    ext.uri = uri
    card.capabilities.extensions = [ext]

    version = try_activate_a2ui_extension(context, card)
    assert version == "0.9"
    assert uri in state["activated_extensions"]
