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

"""Tests for Wave 1 shared decision core extensions and transport lowering."""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx
import pytest

from a2ui.builder.v1_0 import Card, Column, DynamicString, Text
from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.parser.messages import to_message_models
from a2ui.inference_formats.experimental.decision import (
    CatalogDecisionGraph,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    DeterministicMockBackend,
    JevHttpBackend,
    MediaInputPart,
    QuestionKind,
    SlotKind,
    TextInputPart,
    build_inference_catalogs,
    inspect_pointers,
    is_secret_pointer,
    lower_for_transport,
)
from a2ui.transformers.macros import macro


def _make_basic_catalog() -> CatalogApi:
    return BasicCatalog("v1.0")


def test_decision_batch_defaults_and_state_xor() -> None:
    q = DecisionQuestion(id="q1", kind=QuestionKind.BOOLEAN, prompt="Needs UI?")
    batch = DecisionBatch(state="user asked for status", questions=(q,))
    assert batch.state == "user asked for status"
    assert batch.shared_context == {}
    assert batch.input_parts == ()

    with pytest.raises(ValueError, match="mutually exclusive"):
        DecisionBatch(
            shared_context={"intent": "x"},
            state="explicit state",
            questions=(q,),
        )


def test_media_input_part_validation() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        MediaInputPart(modality="image", mime_type="image/png")

    with pytest.raises(ValueError, match="https:// or gs://"):
        MediaInputPart(
            modality="document", mime_type="application/pdf", uri="file:///etc/passwd"
        )

    raw_b64 = base64.b64encode(b"hello world").decode("ascii")
    part = MediaInputPart(
        modality="image",
        mime_type="image/png",
        data_b64=raw_b64,
        resolution="high",
    )
    assert part.data_b64 == raw_b64

    with pytest.raises(ValueError, match="exceeds max_inline_bytes"):
        MediaInputPart(
            modality="image",
            mime_type="image/png",
            data_b64=raw_b64,
            max_inline_bytes=4,
        )


@pytest.mark.asyncio
async def test_jev_gemini_state_input_parts_and_safety_block() -> None:
    seen_payloads: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        seen_payloads.append(body)
        if body.get("input") == "trigger-safety":
            return httpx.Response(
                200,
                json={"promptFeedback": {"blockReason": "SAFETY"}},
            )
        return httpx.Response(
            200,
            json={"answers": {"q_0": {"noul": 0.9}}},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    backend = JevHttpBackend(
        "https://generativelanguage.googleapis.com/v1beta/decisions",
        auth="test-key",
        client=client,
    )
    assert backend.capabilities.supports_media is True

    q = DecisionQuestion(id="gate", kind=QuestionKind.BOOLEAN, prompt="Needs UI?")
    ans = await backend.answer(
        DecisionBatch(state="explicit state text", questions=(q,)),
        timeout_seconds=5.0,
    )
    assert len(ans) == 1
    assert seen_payloads[-1]["input"] == "explicit state text"

    img = MediaInputPart(
        modality="document",
        mime_type="application/pdf",
        uri="gs://bucket/doc.pdf",
    )
    await backend.answer(
        DecisionBatch(
            state="context text",
            input_parts=(TextInputPart("extra"), img),
            questions=(q,),
        ),
        timeout_seconds=5.0,
    )
    assert seen_payloads[-1]["input"] == [
        {"type": "text", "text": "context text"},
        {"type": "text", "text": "extra"},
        {
            "type": "document",
            "mime_type": "application/pdf",
            "uri": "gs://bucket/doc.pdf",
        },
    ]

    with pytest.raises(DecisionBackendError, match="blocked by safety filter"):
        await backend.answer(
            DecisionBatch(state="trigger-safety", questions=(q,)),
        )
    await client.aclose()


@pytest.mark.asyncio
async def test_unsupported_media_raises_pre_network_and_mock_accepts_timeout() -> None:
    q = DecisionQuestion(id="gate", kind=QuestionKind.BOOLEAN, prompt="Needs UI?")
    img = MediaInputPart(
        modality="image", mime_type="image/png", uri="https://example.com/a.png"
    )
    transport = httpx.MockTransport(
        lambda req: (_ for _ in ()).throw(AssertionError("should not hit network"))
    )
    client = httpx.AsyncClient(transport=transport)
    sysone = JevHttpBackend(
        "https://example.com/v1/systemone",
        client=client,
    )
    assert sysone.capabilities.supports_media is False
    with pytest.raises(DecisionBackendError, match="does not support MediaInputPart"):
        await sysone.answer(DecisionBatch(input_parts=(img,), questions=(q,)))
    await client.aclose()

    mock = DeterministicMockBackend()
    answers = await mock.answer(
        DecisionBatch(state="some state", questions=(q,)),
        timeout_seconds=1.5,
    )
    assert len(answers) == 1


def test_macro_allowed_parents_literal_primitive_and_transport_lowering() -> None:
    basic = _make_basic_catalog()

    @macro(allowed_parents=("Column", "Card"), allowed_children=("Text",))
    def ProductTile(
        title: DynamicString,
        sku: str,
        in_stock: bool = True,
    ) -> Card:
        """Displays one product tile."""
        label = sku if in_stock else f"{sku} (out)"
        return Card(child=Column(children=[Text(text=title), Text(text=label)]))

    schema = ProductTile.__a2ui_macro__.to_json_schema(use_v1_0=True)
    assert schema["allowedParents"] == ["Column", "Card"]
    assert schema["allowedChildren"] == ["Text"]

    inf_catalogs = build_inference_catalogs(
        [basic],
        macros=[ProductTile],
        macro_catalog_id="urn:test:macros",
    )
    graph = CatalogDecisionGraph(inf_catalogs)
    node = graph.get_component_by_key(("urn:test:macros", "ProductTile"))
    assert node is not None
    assert node.allowed_parents == ("Column", "Card")
    assert node.allowed_children == ("Text",)
    slot_kinds = {s.name: s.kind for s in node.slots}
    assert slot_kinds["title"] is SlotKind.DATA_VALUE
    assert slot_kinds["sku"] is SlotKind.LITERAL_PRIMITIVE
    assert slot_kinds["in_stock"] is SlotKind.LITERAL_PRIMITIVE

    # Lower a macro-based createSurface and validate against basic transport catalog.
    raw_msgs = to_message_models([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": basic.catalog_id},
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "ProductTile",
                    "@catalogId": "urn:test:macros",
                    "title": {"@path": "/name"},
                    "sku": "SKU-42",
                    "in_stock": True,
                }],
            },
        },
    ])
    lowered = lower_for_transport(
        raw_msgs,
        transport_catalogs=[basic],
        macros=[ProductTile],
        macro_catalog_id="urn:test:macros",
    )
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    comp_types = [c["component"] for c in dumped[1]["updateComponents"]["components"]]
    assert "ProductTile" not in comp_types
    assert "Card" in comp_types

    # Shadowed Client-Side Template in transport_catalogs passes through unexpanded.
    cst_catalog = Catalog.from_json(
        {
            "catalogId": "urn:test:cst",
            "components": {
                "ProductTile": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "sku": {"type": "string"},
                        "in_stock": {"type": "boolean"},
                    },
                    "required": ["title", "sku"],
                }
            },
        },
        protocol_version=ProtocolVersion.V1_0,
    )
    cst_msgs = to_message_models([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s2", "catalogId": "urn:test:cst"},
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "s2",
                "components": [{
                    "id": "root",
                    "component": "ProductTile",
                    "title": "Widget",
                    "sku": "SKU-99",
                    "in_stock": False,
                }],
            },
        },
    ])
    cst_out = lower_for_transport(
        cst_msgs,
        transport_catalogs=[basic, cst_catalog],
        macros=[ProductTile],
        macro_catalog_id="urn:test:macros",
    )
    cst_dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in cst_out]
    assert (
        cst_dumped[1]["updateComponents"]["components"][0]["component"] == "ProductTile"
    )


def test_shared_inspect_pointers_redacts_non_mutable_secrets() -> None:
    ptrs = inspect_pointers(
        {"title": "Account", "api_key": "sk-secret", "password": "pw"},
        mutable_paths={"/password"},
        labels={"/title": "Heading"},
    )
    paths = {p.path: p for p in ptrs}
    assert "/title" in paths
    assert paths["/title"].label == "Heading"
    assert "/api_key" not in paths
    assert "/password" in paths
    assert is_secret_pointer(paths["/password"]) is True
