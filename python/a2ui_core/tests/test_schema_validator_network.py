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

"""Tests that schema validation never fetches a `$ref` over the network."""

from __future__ import annotations

import socket
from typing import Any
import urllib.request

import pytest
import referencing.exceptions

from a2ui.core import A2uiValidationError, Catalog, PayloadValidator
from a2ui.core.validation import SchemaValidator


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Records and refuses every outbound connection the test attempts."""
    attempts: list[str] = []

    def refuse(target: Any, *args: Any, **kwargs: Any) -> Any:
        attempts.append(repr(getattr(target, "full_url", target)))
        raise AssertionError(f"unexpected network access: {target!r}")

    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", lambda self, address: refuse(address))
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    return attempts


def test_ref_to_a_remote_document_is_an_error_without_network(
    no_network: list[str],
) -> None:
    # v0.9 catalogs may still carry external refs; v1.0 rejects them on load.
    catalog = Catalog.from_json(
        {
            "catalogId": "https://example.com/catalogs/arcana/v1/catalog.json",
            "protocolVersion": "0.9",
            "components": {
                "Rune": {
                    "type": "object",
                    "allOf": [{
                        "$ref": (
                            "https://remote.example.com/catalog.json#/components/Text"
                        )
                    }],
                    "properties": {"component": {"const": "Rune"}},
                    "required": ["component"],
                }
            },
        },
        protocol_version="v0.9",
    )

    with pytest.raises(A2uiValidationError, match="remote.example.com"):
        PayloadValidator(catalog).validate_component({"id": "r", "component": "Rune"})
    assert no_network == []


def test_meta_schema_ref_resolves_without_network(
    no_network: list[str],
) -> None:
    """The bundled JSON Schema meta-schemas stay resolvable without the network."""
    validator = SchemaValidator(
        {"$ref": "https://json-schema.org/draft/2020-12/schema"}
    )
    assert validator.is_valid({"type": "string"})
    assert not validator.is_valid({"type": 12})
    assert no_network == []


def test_evolve_keeps_no_retrieval_registry(no_network: list[str]) -> None:
    """A subschema with its own $schema is evolved without losing the registry."""
    validator = SchemaValidator({
        "properties": {
            "x": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "$ref": "https://example.com/not-held.json",
            }
        }
    })
    with pytest.raises(referencing.exceptions.Unresolvable, match="not-held.json"):
        list(validator.iter_errors({"x": 1}))
    assert no_network == []
