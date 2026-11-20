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

"""Unit tests for `ToolPointerBinder`."""

from __future__ import annotations

from typing import Any, Literal
import warnings

from pydantic import BaseModel
import pytest

from a2ui.builder.v1_0 import (
    Action,
    Button,
    Card,
    CheckRule,
    Column,
    ComponentBuilderNode,
    DynamicString,
    Text,
)
from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.experimental.decision import (
    ActionSpec,
    DecisionAnswer,
    DecisionBackendError,
    DecisionBatch,
    DecisionDistribution,
    DeterministicMockBackend,
    QuestionKind,
)
from a2ui.inference_formats.experimental.decision_binder import (
    ExpressSurfaceSpec,
    ToolPointerBinder,
)
from a2ui.transformers.macros import macro


def _basic() -> CatalogApi:
    return BasicCatalog("v1.0")


class _ScriptedBackend(DeterministicMockBackend):
    """Deterministic backend returning explicit scripted answers by question ID."""

    def __init__(
        self,
        answers: dict[str, DecisionAnswer | tuple[str, float] | float],
        *,
        fail_with: DecisionBackendError | None = None,
    ) -> None:
        super().__init__()
        self._answers = answers
        self._fail_with = fail_with

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        del timeout_seconds
        self.batches.append(batch)
        if self._fail_with is not None:
            raise self._fail_with
        out: list[DecisionAnswer] = []
        for q in batch.questions:
            spec = self._answers.get(q.id)
            if isinstance(spec, DecisionAnswer):
                out.append(spec)
                continue
            if q.kind is QuestionKind.BOOLEAN:
                yes_p = float(spec) if isinstance(spec, (int, float)) else 0.9
                out.append(
                    DecisionAnswer(
                        question_id=q.id,
                        distribution=DecisionDistribution(
                            {"yes": yes_p, "no": 1.0 - yes_p}
                        ),
                    )
                )
                continue
            if isinstance(spec, tuple):
                opt, prob = spec
                cands = q.candidates()
                rest = (1.0 - prob) / max(1, len(cands) - 1) if len(cands) > 1 else 0.0
                probs = {c: prob if c == opt else rest for c in cands}
                out.append(
                    DecisionAnswer(
                        question_id=q.id,
                        distribution=DecisionDistribution(probs),
                    )
                )
                continue
            out.append(
                self._answer_question(
                    q,
                    {"state": batch.state}
                    if batch.state is not None
                    else batch.shared_context,
                )
            )
        return tuple(out)


@macro()
def ProductCard(
    title: DynamicString,
    sku: str,
    stock_count: int,
    in_stock: bool = True,
    variant: Literal["compact", "detailed"] = "detailed",
    on_buy: Action | None = None,
) -> Card:
    """Renders a product card with title, SKU, stock badge, and optional buy button."""
    badge = f"{sku} ({stock_count} left)" if in_stock else f"{sku} (out of stock)"
    children: list[ComponentBuilderNode] = [
        Text(text=title),
        Text(text=badge, variant="caption" if variant == "compact" else "body"),
    ]
    if on_buy is not None:
        children.append(Button(child=Text(text="Buy"), action=on_buy))
    return Card(child=Column(children=children))


@pytest.mark.asyncio
async def test_bind_express_surface_and_root_sequence_wrapping() -> None:
    basic = _basic()
    weather_spec = ExpressSurfaceSpec(
        id="weather_card",
        description="Shows weather forecast for a city.",
        dsl="""
root = Card(Column([
    Text($/city, variant="caption"),
    Text($/summary)
]))
""",
        required_paths=("/city", "/summary"),
    )
    list_spec = ExpressSurfaceSpec(
        id="items_list",
        description="Shows a list of search results.",
        dsl="""
root = Column(children=[item_row])
item_row = Text($/items/0/name)
""",
        required_paths=("/items",),
    )

    backend = _ScriptedBackend({"select:target": ("express:weather_card", 0.92)})
    binder = ToolPointerBinder(
        backend,
        transport_catalogs=[basic],
        express_surfaces=[weather_spec, list_spec],
    )
    result = await binder.bind_tool_output(
        "Show Seattle weather",
        "get_weather",
        {"city": "Seattle", "summary": "Sunny 72F"},
        surface_id="weather_s1",
    )
    assert not result.abstained
    assert result.target_id == "express:weather_card"
    assert result.decision_calls == 1
    assert result.confidence == pytest.approx(0.92)
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in result.messages]
    assert dumped[0]["createSurface"]["surfaceId"] == "weather_s1"
    assert dumped[-1]["updateDataModel"]["value"] == {
        "city": "Seattle",
        "summary": "Sunny 72F",
    }

    # Root sequence is wrapped as {"items": tool_output} and matches /items.
    seq_backend = _ScriptedBackend({"select:target": ("express:items_list", 0.88)})
    seq_binder = ToolPointerBinder(
        seq_backend,
        transport_catalogs=[basic],
        express_surfaces=[weather_spec, list_spec],
    )
    seq_result = await seq_binder.bind_tool_output(
        "List matching products",
        "list_items",
        [{"name": "Alpha"}, {"name": "Beta"}],
        surface_id="list_s1",
    )
    assert not seq_result.abstained
    assert seq_result.target_id == "express:items_list"
    seq_dumped = [
        m.model_dump(by_alias=True, exclude_none=True) for m in seq_result.messages
    ]
    assert seq_dumped[-1]["updateDataModel"]["value"] == {
        "items": [{"name": "Alpha"}, {"name": "Beta"}]
    }


@pytest.mark.asyncio
async def test_bind_product_card_macro_all_slot_kinds_and_lowering() -> None:
    basic = _basic()
    macro_cid = "urn:test:macros"
    tkey = f"{macro_cid}:ProductCard"
    backend = _ScriptedBackend({
        "select:target": (tkey, 0.94),
        f"bind:{tkey}:title": ("/title", 0.95),
        f"bind:{tkey}:sku": ("/sku", 0.95),
        f"bind:{tkey}:stock_count": ("/inventory", 0.92),
        f"bind:{tkey}:in_stock": 0.91,
        f"bind:{tkey}:variant": ("compact", 0.85),
        f"bind:{tkey}:on_buy": ("add_to_cart", 0.90),
    })
    binder = ToolPointerBinder(
        backend,
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
    )
    result = await binder.bind_tool_output(
        "Show running shoes product card",
        "get_product",
        {"title": "Trail Runner", "sku": "SKU-42", "inventory": 7},
        actions=[
            ActionSpec(id="add_to_cart", label="Add to Cart", context={"sku": "/sku"})
        ],
        surface_id="prod_s1",
    )

    assert not result.abstained
    assert result.target_id == tkey
    assert result.decision_calls == 1
    assert result.bindings["title"] == {"@path": "/title"}
    assert result.bindings["sku"] == "SKU-42"
    assert result.bindings["stock_count"] == 7
    assert result.bindings["in_stock"] is True
    assert result.bindings["variant"] == "compact"
    assert result.bindings["on_buy"] == {
        "event": {"name": "add_to_cart", "context": {"sku": {"@path": "/sku"}}}
    }

    # Verify macro was lowered to BasicCatalog primitives via lower_for_transport.
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in result.messages]
    comp_types = [c["component"] for c in dumped[1]["updateComponents"]["components"]]
    assert "ProductCard" not in comp_types
    assert "Card" in comp_types
    assert "Button" in comp_types
    # Verify explicit state string was sent on DecisionBatch (not shared_context).
    assert backend.batches[0].state is not None
    assert backend.batches[0].shared_context == {}


@pytest.mark.asyncio
async def test_client_side_template_passthrough_and_macro_shadowing_parity() -> None:
    basic = _basic()
    cst_catalog = Catalog.from_json(
        {
            "catalogId": "urn:test:cst",
            "components": {
                "ProductCard": {
                    "type": "object",
                    "description": "Renders a product card.",
                    "properties": {
                        "title": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "sku": {"type": "string"},
                        "stock_count": {"type": "integer"},
                        "in_stock": {"type": "boolean"},
                        "variant": {
                            "type": "string",
                            "enum": ["compact", "detailed"],
                        },
                        "on_buy": {"$ref": "common_types.json#/$defs/Action"},
                    },
                    "required": ["title", "sku", "stock_count"],
                }
            },
        },
        protocol_version=ProtocolVersion.V1_0,
    )
    cst_key = "urn:test:cst:ProductCard"
    backend = _ScriptedBackend({
        "select:target": (cst_key, 0.91),
        f"bind:{cst_key}:title": ("/title", 0.95),
        f"bind:{cst_key}:sku": ("/sku", 0.95),
        f"bind:{cst_key}:stock_count": ("/inventory", 0.95),
        f"bind:{cst_key}:in_stock": 0.2,
        f"bind:{cst_key}:variant": ("detailed", 0.9),
        f"bind:{cst_key}:on_buy": ("none", 0.8),
    })

    # Pass both macros=[ProductCard] and cst_catalog: CST shadows the macro.
    binder = ToolPointerBinder(
        backend,
        transport_catalogs=[basic, cst_catalog],
        macros=[ProductCard],
        macro_catalog_id="urn:test:macros",
    )
    assert binder.target_keys() == (cst_key,)

    result = await binder.bind_tool_output(
        "Show product",
        "get_product",
        {"title": "Boots", "sku": "SKU-99", "inventory": 3},
        actions=["buy_now"],
        surface_id="cst_s1",
    )
    assert not result.abstained
    assert result.target_id == cst_key
    assert result.bindings["in_stock"] is False
    assert "on_buy" not in result.bindings  # Optional Action chose "none"

    # CST passes through unexpanded on the wire.
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in result.messages]
    assert dumped[0]["createSurface"]["catalogId"] == "urn:test:cst"
    root_comp = dumped[1]["updateComponents"]["components"][0]
    assert root_comp["component"] == "ProductCard"
    assert root_comp["title"] == {"@path": "/title"}
    assert root_comp["sku"] == "SKU-99"
    assert root_comp["stock_count"] == 3
    assert root_comp["in_stock"] is False


def test_macro_registration_rejects_unsupported_parameters() -> None:
    basic = _basic()
    backend = DeterministicMockBackend()

    class _NestedItem(BaseModel):
        code: str

    @macro()
    def WithChild(title: DynamicString, body: Text) -> Card:
        return Card(child=Column(children=[Text(text=title), body]))

    @macro()
    def WithChildList(title: DynamicString, items: list[Text]) -> Column:
        return Column(children=[Text(text=title), *items])

    @macro()
    def WithCheckRule(title: DynamicString, rule: CheckRule) -> Card:
        del rule
        return Card(child=Text(text=title))

    @macro()
    def WithNestedModel(title: DynamicString, meta: _NestedItem) -> Card:
        return Card(child=Column(children=[Text(text=title), Text(text=meta.code)]))

    @macro()
    def ZeroBindableSlots(flag: bool = True) -> Text:
        return Text(text="yes" if flag else "no")

    def not_a_macro(title: str) -> str:
        return title

    for bad_macro in (
        WithChild,
        WithChildList,
        WithCheckRule,
        WithNestedModel,
        ZeroBindableSlots,
        not_a_macro,
    ):
        with pytest.raises(A2uiCatalogError):
            ToolPointerBinder(
                backend,
                transport_catalogs=[basic],
                macros=[bad_macro],
            )


@pytest.mark.asyncio
async def test_splits_into_two_calls_when_pairs_exceed_400() -> None:
    basic = _basic()
    # Create 10 CST components each with 3 DynamicString slots + 15 string pointers:
    # 10 * 3 * 15 = 450 slot pairs + 11 target candidates = 461 > 400 -> 2 calls!
    components: dict[str, Any] = {}
    for idx in range(10):
        components[f"Card{idx}"] = {
            "type": "object",
            "description": f"Card variant {idx}",
            "properties": {
                "a": {"$ref": "common_types.json#/$defs/DynamicString"},
                "b": {"$ref": "common_types.json#/$defs/DynamicString"},
                "c": {"$ref": "common_types.json#/$defs/DynamicString"},
            },
            "required": ["a", "b", "c"],
        }
    large_cst = Catalog.from_json(
        {"catalogId": "urn:test:large", "components": components},
        protocol_version=ProtocolVersion.V1_0,
    )
    winner_key = "urn:test:large:Card3"
    backend = _ScriptedBackend({
        "select:target": (winner_key, 0.90),
        f"bind:{winner_key}:a": ("/f0", 0.9),
        f"bind:{winner_key}:b": ("/f1", 0.9),
        f"bind:{winner_key}:c": ("/f2", 0.9),
    })
    binder = ToolPointerBinder(backend, transport_catalogs=[basic, large_cst])
    payload = {f"f{i}": f"val_{i}" for i in range(15)}

    result = await binder.bind_tool_output("Show card 3", "fetch_data", payload)
    assert not result.abstained
    assert result.decision_calls == 2
    assert len(backend.batches) == 2
    assert [q.id for q in backend.batches[0].questions] == ["select:target"]
    assert {q.id for q in backend.batches[1].questions} == {
        f"bind:{winner_key}:a",
        f"bind:{winner_key}:b",
        f"bind:{winner_key}:c",
    }

    # Early abstention on call 1 avoids call 2.
    abstain_backend = _ScriptedBackend({"select:target": ("none", 0.85)})
    abstain_binder = ToolPointerBinder(
        abstain_backend, transport_catalogs=[basic, large_cst]
    )
    abstain_res = await abstain_binder.bind_tool_output(
        "Unrelated text", "fetch_data", payload
    )
    assert abstain_res.abstained
    assert abstain_res.decision_calls == 1
    assert len(abstain_backend.batches) == 1


@pytest.mark.asyncio
async def test_abstention_conditions_and_backend_error_propagation() -> None:
    basic = _basic()
    macro_cid = "urn:test:macros"
    tkey = f"{macro_cid}:ProductCard"

    # 1. Empty payload / empty sequence / scalar -> abstain with 0 calls.
    zero_backend = _ScriptedBackend({})
    binder = ToolPointerBinder(
        zero_backend,
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
    )
    for empty_payload in ({}, [], "not json", 123):
        res = await binder.bind_tool_output("Show", "tool", empty_payload)
        assert res.abstained
        assert res.messages == []
        assert res.decision_calls == 0
    assert len(zero_backend.batches) == 0

    # 2. Target selection returns "none".
    none_binder = ToolPointerBinder(
        _ScriptedBackend({"select:target": ("none", 0.9)}),
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
    )
    none_res = await none_binder.bind_tool_output(
        "Show", "tool", {"title": "A", "sku": "S", "inventory": 1}
    )
    assert none_res.abstained
    assert "none" in none_res.reason

    # 3. Target confidence below min_confidence (0.65).
    low_conf_binder = ToolPointerBinder(
        _ScriptedBackend({"select:target": (tkey, 0.52)}),
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
        min_confidence=0.65,
    )
    low_res = await low_conf_binder.bind_tool_output(
        "Show", "tool", {"title": "A", "sku": "S", "inventory": 1}
    )
    assert low_res.abstained
    assert "min_confidence" in low_res.reason

    # 4. Missing required slot (backend returns zero-prob / none for required slot).
    missing_slot_binder = ToolPointerBinder(
        _ScriptedBackend({
            "select:target": (tkey, 0.95),
            f"bind:{tkey}:title": DecisionAnswer(
                question_id=f"bind:{tkey}:title",
                distribution=DecisionDistribution({"/title": 0.0}),
            ),
            f"bind:{tkey}:sku": ("/sku", 0.9),
            f"bind:{tkey}:stock_count": ("/inventory", 0.9),
        }),
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
    )
    missing_res = await missing_slot_binder.bind_tool_output(
        "Show", "tool", {"title": "A", "sku": "S", "inventory": 1}
    )
    assert missing_res.abstained
    assert "required slot" in missing_res.reason

    # 5. DecisionBackendError propagates without silent fallback.
    err_binder = ToolPointerBinder(
        _ScriptedBackend(
            {},
            fail_with=DecisionBackendError(
                "safety blocked", backend_kind="gemini", model_id="gemini-decision-1"
            ),
        ),
        transport_catalogs=[basic],
        macros=[ProductCard],
        macro_catalog_id=macro_cid,
    )
    with pytest.raises(DecisionBackendError, match="safety blocked"):
        await err_binder.bind_tool_output(
            "Show", "tool", {"title": "A", "sku": "S", "inventory": 1}
        )


def test_tool_pointer_binder_emits_experimental_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS", raising=False)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ToolPointerBinder(
            DeterministicMockBackend(),
            transport_catalogs=[_basic()],
        )
    assert any("[EXPERIMENTAL] ToolPointerBinder" in str(w.message) for w in caught)


@pytest.mark.asyncio
async def test_update_data_model_redacts_secrets_and_excluded_paths() -> None:
    basic = _basic()
    spec = ExpressSurfaceSpec(
        id="profile",
        description="User profile card",
        dsl="root = Text($/name)",
        required_paths=("/name",),
    )
    backend = DeterministicMockBackend(
        scripted_answers={"select:target": ("express:profile", 0.95)}
    )
    binder = ToolPointerBinder(
        backend,
        transport_catalogs=[basic],
        express_surfaces=[spec],
    )
    result = await binder.bind_tool_output(
        "Show profile",
        "get_profile",
        {
            "name": "Ada",
            "apiKey": "sk_live_" + ("x" * 72),
            "internal_note": "private",
            "nested": {"password": "pw", "role": "engineer"},
        },
        exclude=("/internal_note",),
    )
    assert not result.abstained
    data_msgs = [
        m.model_dump(by_alias=True, exclude_none=True)["updateDataModel"]["value"]
        for m in result.messages
        if "updateDataModel" in m.model_dump(by_alias=True, exclude_none=True)
    ]
    assert len(data_msgs) == 1
    assert data_msgs[0] == {"name": "Ada", "nested": {"role": "engineer"}}


@pytest.mark.asyncio
async def test_omitted_select_target_answer_raises_decision_backend_error() -> None:
    class _EmptyBackend(DeterministicMockBackend):

        async def answer(
            self, batch: DecisionBatch, *, timeout_seconds: float | None = None
        ) -> tuple[Any, ...]:
            del batch, timeout_seconds
            return ()

    basic = _basic()
    spec = ExpressSurfaceSpec(
        id="profile",
        description="User profile card",
        dsl="root = Text($/name)",
        required_paths=("/name",),
    )
    binder = ToolPointerBinder(
        _EmptyBackend(),
        transport_catalogs=[basic],
        express_surfaces=[spec],
    )
    with pytest.raises(DecisionBackendError, match="select:target"):
        await binder.bind_tool_output("Show profile", "get_profile", {"name": "Ada"})
