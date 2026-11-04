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

"""Tests for `renderer_capabilities_from_message`."""

from __future__ import annotations

from a2a.types import DataPart
from a2a.types import Message
from a2a.types import Part
from a2a.types import Role
from a2a.types import TextPart
import pytest

from a2ui.a2a import renderer_capabilities_from_message
from a2ui.core import A2uiCatalogError
from a2ui.core.schema import ProtocolVersion


def _make_message(
    *,
    metadata: dict | None = None,
    parts: list[Part] | None = None,
) -> Message:
    return Message(
        message_id="msg-1",
        role=Role.user,
        parts=parts or [Part(root=TextPart(text="hello"))],
        metadata=metadata,
    )


def test_message_metadata_wins_over_part_fallbacks() -> None:
    msg = _make_message(
        metadata={
            "a2uiRendererCapabilities": {"1.0": {"supportedCatalogIds": ["cat-msg"]}}
        },
        parts=[
            Part(
                root=DataPart(
                    data={
                        "metadata": {
                            "a2uiRendererCapabilities": {
                                "1.0": {"supportedCatalogIds": ["cat-data"]}
                            }
                        }
                    },
                    metadata={
                        "a2uiRendererCapabilities": {
                            "1.0": {"supportedCatalogIds": ["cat-part"]}
                        }
                    },
                )
            )
        ],
    )
    assert renderer_capabilities_from_message(msg, ProtocolVersion.V1_0) == {
        "1.0": {"supportedCatalogIds": ["cat-msg"]}
    }


def test_data_part_metadata_wins_over_legacy_data_dict_metadata() -> None:
    msg = _make_message(
        parts=[
            Part(
                root=DataPart(
                    data={
                        "metadata": {
                            "a2uiClientCapabilities": {
                                "v0.9": {"supportedCatalogIds": ["cat-data"]}
                            }
                        }
                    },
                    metadata={
                        "a2uiClientCapabilities": {
                            "v0.9": {"supportedCatalogIds": ["cat-part"]}
                        }
                    },
                )
            )
        ]
    )
    assert renderer_capabilities_from_message(msg, ProtocolVersion.V0_9) == {
        "v0.9": {"supportedCatalogIds": ["cat-part"]}
    }


def test_legacy_data_part_dict_metadata_fallback() -> None:
    msg = _make_message(
        parts=[
            Part(
                root=DataPart(
                    data={
                        "metadata": {
                            "a2uiClientCapabilities": {
                                "supportedCatalogIds": ["cat-v08"]
                            }
                        }
                    }
                )
            )
        ]
    )
    assert renderer_capabilities_from_message(msg, ProtocolVersion.V0_8) == {
        "v0.8": {"supportedCatalogIds": ["cat-v08"]}
    }


def test_no_capabilities_or_none_message_returns_none() -> None:
    assert renderer_capabilities_from_message(None, ProtocolVersion.V1_0) is None
    assert (
        renderer_capabilities_from_message(_make_message(), ProtocolVersion.V1_0)
        is None
    )


def test_turn_scoped_later_turn_without_key_returns_none() -> None:
    turn_1 = _make_message(
        metadata={
            "a2uiRendererCapabilities": {"1.0": {"supportedCatalogIds": ["cat-1"]}}
        }
    )
    turn_2 = _make_message(metadata={"otherKey": "value"})
    assert renderer_capabilities_from_message(turn_1, "1.0") == {
        "1.0": {"supportedCatalogIds": ["cat-1"]}
    }
    assert renderer_capabilities_from_message(turn_2, "1.0") is None


def test_malformed_capabilities_raises_catalog_error() -> None:
    msg = _make_message(
        metadata={"a2uiRendererCapabilities": {"1.0": {"supportedCatalogIds": "bad"}}}
    )
    with pytest.raises(A2uiCatalogError):
        renderer_capabilities_from_message(msg, ProtocolVersion.V1_0)
