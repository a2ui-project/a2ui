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

"""Unit tests for catalog pattern libraries, expander, and archetype eligibility."""

from __future__ import annotations

from collections.abc import Sequence
import copy
from typing import Any

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision.archetypes import (
    ArchetypeGrammar,
    load_asset,
)
from a2ui.inference_formats.decision.catalog_graph import CatalogDecisionGraph
from a2ui.inference_formats.decision.layout_planner import LayoutPlanner
from a2ui.inference_formats.decision.models import (
    ActionSpec,
    BlockBindings,
    PageBindings,
    SemanticType,
    SlotBinding,
)
from a2ui.inference_formats.decision.patterns import (
    MergedPatternLibrary,
    PatternError,
    PatternExpander,
    PatternLibrary,
    PatternRef,
    ResolvedPattern,
    eligible_archetypes,
    resolve_fallback_pattern,
    shape_signature,
)
from a2ui.inference_formats.decision.payload_inspector import (
    inspect_payload_pointers,
)
from a2ui.utils import validate_payload
import pytest

from .layout_fixtures import HOST, RESORT, SETTINGS, TRANSFER, mock_backend


def _two_component_domain_catalog() -> Catalog:
    """Two-component domain catalog (`TelemetryBadge`, `AlertFrame`) with no basic patterns."""
    return Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/telemetry/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "TelemetryBadge": {
                "type": "object",
                "properties": {
                    "component": {"const": "TelemetryBadge"},
                    "metric": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "metric"],
            },
            "AlertFrame": {
                "type": "object",
                "properties": {
                    "component": {"const": "AlertFrame"},
                    "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "child"],
            },
        },
        "functions": {},
    })


def _wrap_surface(components: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Wraps expanded v1.0 `components` in a valid `createSurface` + `updateComponents` envelope."""
    has_root = any(c.get("id") == "root" for c in components)
    all_comps = [dict(c) for c in components]
    if not has_root:
        first_id = str(all_comps[0]["id"])
        all_comps.insert(
            0,
            {
                "id": "root",
                "component": "Column",
                "children": [first_id],
            },
        )
    catalog_id = BasicCatalog("1.0").catalog_id
    return [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test_surface",
                "catalogId": catalog_id,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "test_surface",
                "components": all_comps,
            },
        },
    ]


# --- 1. Schema Rejection & Grammar Version Mismatch ---


def test_pattern_library_rejects_missing_root() -> None:
    raw = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    del raw["patterns"]["banner"]["root"]
    with pytest.raises(PatternError, match="banner"):
        PatternLibrary.from_json(raw)


def test_pattern_library_rejects_unknown_directive_in_children() -> None:
    raw = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    raw["patterns"]["banner"]["components"][0]["children"] = [
        {"$unknownDirective": "banner_text"}
    ]
    with pytest.raises(PatternError):
        PatternLibrary.from_json(raw)


def test_pattern_library_rejects_non_mapping_json() -> None:
    with pytest.raises(PatternError, match="must be an object"):
        PatternLibrary.from_json(["not", "a", "dict"])  # type: ignore[arg-type]


def test_pattern_library_single_catalog_id_and_grammar_version_mismatch() -> None:
    raw = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    lib = PatternLibrary.from_json(raw)
    assert lib.catalog_id == BasicCatalog("v1.0").catalog_id
    assert lib.grammar_version == "1"

    mismatched = copy.deepcopy(raw)
    mismatched["grammarVersion"] = "2"
    with pytest.raises(PatternError, match="grammarVersion '2'.*expected '1'"):
        PatternLibrary.from_json(mismatched)

    mismatched_lib = PatternLibrary(lib.catalog_id, lib.patterns, grammar_version="2")
    catalog = BasicCatalog("v1.0")
    graph = CatalogDecisionGraph([catalog])
    with pytest.raises(PatternError, match="grammarVersion '2'.*expected '1'"):
        PatternExpander(mismatched_lib, graph, grammar=ArchetypeGrammar.default())


# --- 2 & 3. v1.0-Only Catalog Matching & Pattern Capabilities ---


def test_for_catalogs_matches_v1_0_only_and_rejects_v0_9_expander() -> None:
    cat_v10 = BasicCatalog("v1.0")
    cat_v09 = BasicCatalog("v0.9")

    lib_v10 = MergedPatternLibrary.for_catalogs([cat_v10])
    assert lib_v10.has_pattern("page")
    assert lib_v10.has_pattern("headline")
    assert lib_v10.has_pattern("collection", "rows")
    assert lib_v10.has_pattern("collection", "cards")
    assert lib_v10.has_pattern("collection", "reel")
    assert lib_v10.has_pattern("collection:cards")
    assert lib_v10.has_pattern("collection:reel")
    assert not lib_v10.has_pattern("collection", "grid")
    assert not lib_v10.has_pattern("collection:grid")
    assert not lib_v10.has_pattern("chart")
    assert not lib_v10.has_pattern("timeline")
    assert not lib_v10.has_pattern("map")

    lib_v09 = MergedPatternLibrary.for_catalogs([cat_v09])
    assert not lib_v09.has_pattern("page")
    with pytest.raises(ValueError, match="v1.0 only"):
        PatternExpander(lib_v10, CatalogDecisionGraph([cat_v09]))


# --- 4. Multi-Catalog Merge & Primary Catalog Precedence ---


def test_multi_catalog_merge_and_primary_precedence() -> None:
    basic_raw = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    basic_lib = PatternLibrary.from_json(basic_raw)

    domain_raw = {
        "grammarVersion": "1",
        "catalogId": "https://example.com/catalogs/domain/v1/catalog.json",
        "patterns": {
            "chart": {
                "slots": ["series", "title"],
                "root": "chart_root",
                "components": [{
                    "id": "chart_root",
                    "component": "Text",
                    "text": {"$slot": "title", "$default": "Chart"},
                }],
            },
            "headline": {
                "slots": ["items"],
                "root": "domain_headline",
                "components": [{
                    "id": "domain_headline",
                    "component": "Text",
                    "text": {"$slot": "items", "$default": "Headline"},
                }],
            },
        },
    }
    domain_lib = PatternLibrary.from_json(domain_raw)

    merged_domain_first = MergedPatternLibrary([domain_lib, basic_lib])
    assert merged_domain_first.has_pattern("chart")
    assert merged_domain_first.has_pattern("facts")
    assert (
        merged_domain_first.owner_catalog_id("headline")
        == "https://example.com/catalogs/domain/v1/catalog.json"
    )
    headline_pat = merged_domain_first.get("headline")
    assert headline_pat is not None
    assert headline_pat.variants[0].root == "domain_headline"

    merged_basic_first = MergedPatternLibrary([basic_lib, domain_lib])
    assert merged_basic_first.has_pattern("chart")
    assert merged_basic_first.owner_catalog_id("headline") == basic_lib.catalog_id
    basic_headline = merged_basic_first.get("headline")
    assert basic_headline is not None
    assert basic_headline.variants[0].root == "headline_row"


# --- 5 & 6. Eligibility across Fixtures & Domain Catalogs ---


def test_eligibility_on_four_layout_fixtures_against_basic_v1() -> None:
    grammar = ArchetypeGrammar.default()
    lib = MergedPatternLibrary.for_catalogs([BasicCatalog("v1.0")])

    resort_ptrs = inspect_payload_pointers(
        RESORT.payload, mutable_paths=RESORT.mutable_paths
    )
    resort_ids = {a.id for a in eligible_archetypes(grammar, lib, resort_ptrs)}
    assert {"detail", "feed"} <= resort_ids

    host_ptrs = inspect_payload_pointers(HOST.payload, mutable_paths=HOST.mutable_paths)
    host_ids = {a.id for a in eligible_archetypes(grammar, lib, host_ptrs)}
    assert "dashboard" in host_ids

    transfer_ptrs = inspect_payload_pointers(
        TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    transfer_ids = {a.id for a in eligible_archetypes(grammar, lib, transfer_ptrs)}
    assert {"confirm", "checkout", "result"} <= transfer_ids

    settings_ptrs = inspect_payload_pointers(
        SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
    )
    settings_ids = {a.id for a in eligible_archetypes(grammar, lib, settings_ptrs)}
    assert {"settings", "form"} <= settings_ids

    assert not lib.has_pattern("collection", "grid")
    assert eligible_archetypes(grammar, lib, ()) == ()


def test_eligibility_two_component_domain_catalog_has_zero_archetypes() -> None:
    grammar = ArchetypeGrammar.default()
    domain_cat = _two_component_domain_catalog()
    lib = MergedPatternLibrary.for_catalogs([domain_cat])

    for fixture in (RESORT, HOST, TRANSFER, SETTINGS):
        ptrs = inspect_payload_pointers(
            fixture.payload, mutable_paths=fixture.mutable_paths
        )
        assert eligible_archetypes(grammar, lib, ptrs) == ()


# --- 7. Expander on Every Basic v1 Pattern (Zero Coercion) ---


def test_expand_every_basic_v1_pattern_validates_without_coercion() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    # 1. banner
    banner_exp = expander.expand_block(
        "banner",
        "banner",
        BlockBindings(
            slots={
                "title": SlotBinding(pointer="/notice"),
                "text": SlotBinding(literal="Scheduled maintenance"),
            }
        ),
        knobs={"tone": "warning"},
    )
    assert banner_exp.components[0]["id"] == "banner_root"
    validate_payload([catalog], _wrap_surface(banner_exp.components))

    # 2. picture (header & feature variants)
    for prominence in ("full", "supporting"):
        pic_exp = expander.expand_block(
            "picture",
            "picture",
            BlockBindings(
                slots={
                    "picture": SlotBinding(pointer="/photos/0/url"),
                    "caption": SlotBinding(literal="Pool at dusk"),
                }
            ),
            knobs={"framing": "banner", "prominence": prominence},
        )
        assert pic_exp.components[0]["id"] == "picture_root"
        validate_payload([catalog], _wrap_surface(pic_exp.components))

    # 3. media (video & audio)
    for src, title in (
        ("https://example.com/clip.mp4", "Keynote"),
        ("https://example.com/ep1.mp3", "Episode 1"),
    ):
        media_exp = expander.expand_block(
            "media",
            "media",
            BlockBindings(
                slots={
                    "source": SlotBinding(literal=src),
                    "poster": SlotBinding(literal="https://example.com/poster.jpg"),
                    "title": SlotBinding(literal=title),
                    "duration": SlotBinding(literal="12:34"),
                }
            ),
        )
        assert media_exp.components[0]["id"] == "media_root"
        validate_payload([catalog], _wrap_surface(media_exp.components))

    # 4. filters
    filters_exp = expander.expand_block(
        "filters",
        "filters",
        BlockBindings(
            slots={
                "query": SlotBinding(pointer="/query"),
                "categories": SlotBinding(
                    literal=[
                        {"label": "All", "value": "All"},
                        {"label": "Active", "value": "Active"},
                    ],
                    fields={"selected": SlotBinding(pointer="/selected")},
                ),
            }
        ),
    )
    assert filters_exp.components[0]["id"] == "filters_root"
    validate_payload([catalog], _wrap_surface(filters_exp.components))

    # 5. headline
    headline_exp = expander.expand_block(
        "headline",
        "headline",
        BlockBindings(
            slots={
                "items": SlotBinding(
                    items=(
                        {
                            "label": SlotBinding(literal="Rating"),
                            "value": SlotBinding(pointer="/rating"),
                            "delta": SlotBinding(literal="+0.2"),
                            "max": SlotBinding(literal=5),
                        },
                    )
                )
            }
        ),
        knobs={"deltas": "yes", "gauge": "yes"},
    )
    assert headline_exp.components[0]["id"] == "headline_root"
    validate_payload([catalog], _wrap_surface(headline_exp.components))

    # 6. facts
    facts_exp = expander.expand_block(
        "facts",
        "facts",
        BlockBindings(
            slots={
                "rows": SlotBinding(
                    items=(
                        {
                            "label": SlotBinding(literal="CPU"),
                            "value": SlotBinding(pointer="/cpu"),
                        },
                        {
                            "label": SlotBinding(literal="Host"),
                            "value": SlotBinding(pointer="/host"),
                        },
                    )
                )
            }
        ),
    )
    assert facts_exp.components[0]["id"] == "facts_root"
    validate_payload([catalog], _wrap_surface(facts_exp.components))

    # 7. prose
    prose_exp = expander.expand_block(
        "prose",
        "prose",
        BlockBindings(
            slots={
                "heading": SlotBinding(literal="Overview"),
                "body": SlotBinding(pointer="/about"),
            }
        ),
        knobs={"length": "article"},
    )
    assert prose_exp.components[0]["id"] == "prose_root"
    validate_payload([catalog], _wrap_surface(prose_exp.components))

    # 8. collection (rows, cards, reel)
    for layout_knob in ("rows", "cards", "reel"):
        coll_exp = expander.expand_block(
            "collection",
            "collection",
            BlockBindings(
                slots={
                    "items": SlotBinding(
                        pointer="/photos",
                        fields={
                            "headline": SlotBinding(pointer="caption"),
                            "picture": SlotBinding(pointer="url"),
                            "supporting": SlotBinding(literal="View details"),
                            "action": SlotBinding(
                                literal="open_photo",
                                fields={"$key": SlotBinding(literal="id")},
                            ),
                        },
                    )
                }
            ),
            knobs={
                "layout": layout_knob,
                "trailing": "button",
                "trailing.label": "View",
            },
        )
        assert coll_exp.components[0]["id"] == "collection_root"
        validate_payload([catalog], _wrap_surface(coll_exp.components))

    # 9. comparison
    comp_exp = expander.expand_block(
        "comparison",
        "comparison",
        BlockBindings(
            slots={
                "options": SlotBinding(
                    items=(
                        {
                            "headline": SlotBinding(literal="Basic"),
                            "highlight": SlotBinding(literal="$10/mo"),
                            "attributes": SlotBinding(
                                items=(
                                    {
                                        "label": SlotBinding(literal="Seats"),
                                        "value": SlotBinding(literal="1"),
                                    },
                                )
                            ),
                        },
                        {
                            "headline": SlotBinding(literal="Pro"),
                            "highlight": SlotBinding(literal="$25/mo"),
                            "attributes": SlotBinding(
                                items=(
                                    {
                                        "label": SlotBinding(literal="Seats"),
                                        "value": SlotBinding(literal="10"),
                                    },
                                )
                            ),
                        },
                    )
                )
            }
        ),
    )
    assert comp_exp.components[0]["id"] == "comparison_root"
    validate_payload([catalog], _wrap_surface(comp_exp.components))

    # 10. steps
    steps_exp = expander.expand_block(
        "steps",
        "steps",
        BlockBindings(
            slots={
                "items": SlotBinding(
                    items=(
                        {
                            "title": SlotBinding(literal="Verify"),
                            "detail": SlotBinding(literal="Checked"),
                            "state": SlotBinding(literal="done"),
                        },
                        {
                            "title": SlotBinding(literal="Confirm"),
                            "state": SlotBinding(literal="active"),
                        },
                    )
                )
            }
        ),
        knobs={"numbered": "yes"},
    )
    assert steps_exp.components[0]["id"] == "steps_root"
    validate_payload([catalog], _wrap_surface(steps_exp.components))

    # 11. form (all 9 fieldVariants)
    choice_opts = [
        {"label": "Alpha", "value": "A"},
        {"label": "Beta", "value": "B"},
    ]
    form_items = []
    for idx, control in enumerate((
        "shortText",
        "longText",
        "number",
        "obscured",
        "toggle",
        "choice",
        "multiChoice",
        "range",
        "date",
    )):
        form_items.append({
            "label": SlotBinding(literal=f"Field {idx}"),
            "value": SlotBinding(pointer=f"/f{idx}"),
            "options": SlotBinding(literal=choice_opts),
            "min": SlotBinding(literal=0),
            "max": SlotBinding(literal=100),
            "control": SlotBinding(literal=control),
        })
    form_exp = expander.expand_block(
        "form",
        "form",
        BlockBindings(slots={"fields": SlotBinding(items=tuple(form_items))}),
    )
    assert form_exp.components[0]["id"] == "form_root"
    validate_payload([catalog], _wrap_surface(form_exp.components))
    form_comp_types = {c["component"] for c in form_exp.components}
    assert {
        "TextField",
        "CheckBox",
        "ChoicePicker",
        "Slider",
        "DateTimeInput",
    } <= form_comp_types

    # 12. groups (all 4 fieldVariants)
    group_rows = [
        {
            "label": SlotBinding(literal="Notifications"),
            "value": SlotBinding(pointer="/notifications/newEpisodes"),
            "row_kind": SlotBinding(literal="switch"),
        },
        {
            "label": SlotBinding(literal="Skip forward"),
            "value": SlotBinding(pointer="/playback/skipForward"),
            "row_kind": SlotBinding(literal="value"),
        },
        {
            "label": SlotBinding(literal="Privacy"),
            "row_kind": SlotBinding(literal="navigation"),
        },
        {
            "label": SlotBinding(literal="Sign out"),
            "row_kind": SlotBinding(literal="danger"),
        },
    ]
    groups_exp = expander.expand_block(
        "groups",
        "groups",
        BlockBindings(
            slots={
                "groups": SlotBinding(
                    items=(
                        {
                            "heading": SlotBinding(literal="General"),
                            "rows": SlotBinding(items=tuple(group_rows)),
                        },
                    )
                )
            }
        ),
    )
    assert groups_exp.components[0]["id"] == "groups_root"
    validate_payload([catalog], _wrap_surface(groups_exp.components))
    groups_comp_types = {c["component"] for c in groups_exp.components}
    assert {"CheckBox", "Button", "Text"} <= groups_comp_types

    # 13. actions
    actions_exp = expander.expand_block(
        "actions",
        "actions",
        BlockBindings(
            slots={
                "buttons": SlotBinding(
                    items=(
                        {
                            "action": SlotBinding(literal="send"),
                            "label": SlotBinding(literal="Send"),
                        },
                        {
                            "action": SlotBinding(literal="cancel"),
                            "label": SlotBinding(literal="Cancel"),
                        },
                    )
                )
            }
        ),
        knobs={"order": "primaryLast"},
        instances={"send": {"primary": "true"}},
    )
    assert actions_exp.components[0]["id"] == "actions_root"
    validate_payload([catalog], _wrap_surface(actions_exp.components))

    # 14. outcome
    outcome_exp = expander.expand_block(
        "outcome",
        "outcome",
        BlockBindings(
            slots={
                "headline": SlotBinding(literal="Transfer Complete"),
                "detail": SlotBinding(literal="Ref #1024"),
                "tone": SlotBinding(literal="success"),
            }
        ),
    )
    assert outcome_exp.components[0]["id"] == "outcome_root"
    validate_payload([catalog], _wrap_surface(outcome_exp.components))

    # 15. conversation
    conv_exp = expander.expand_block(
        "conversation",
        "conversation",
        BlockBindings(
            slots={
                "messages": SlotBinding(
                    items=(
                        {
                            "author": SlotBinding(literal="Alex"),
                            "text": SlotBinding(literal="Hello!"),
                            "time": SlotBinding(literal="10:00"),
                        },
                        {
                            "author": SlotBinding(literal="me"),
                            "text": SlotBinding(literal="Hi Alex!"),
                            "time": SlotBinding(literal="10:01"),
                        },
                    )
                )
            }
        ),
        knobs={"self": "me"},
    )
    assert conv_exp.components[0]["id"] == "conversation_root"
    validate_payload([catalog], _wrap_surface(conv_exp.components))

    # 16. compose
    compose_exp = expander.expand_block(
        "compose",
        "compose",
        BlockBindings(
            slots={
                "draft": SlotBinding(pointer="/draft"),
                "sendLabel": SlotBinding(literal="Send"),
            }
        ),
    )
    assert compose_exp.components[0]["id"] == "compose_root"
    validate_payload([catalog], _wrap_surface(compose_exp.components))

    # 17. page (default & dialog)
    for dialog in (False, True):
        page_exp = expander.expand_page(
            PageBindings(
                title=SlotBinding(literal="Casa Verde"),
                subtitle=SlotBinding(literal="Hillside Resort"),
                mark=SlotBinding(literal="https://example.com/logo.png"),
                dialog=dialog,
            ),
            block_roots=[headline_exp.components[0]["id"]],
            blocks=[headline_exp],
        )
        assert page_exp.components[0]["id"] == "root"
        validate_payload(
            [catalog],
            _wrap_surface((*page_exp.components, *headline_exp.components)),
        )


# --- 8. Explicit Actions, Non-Latin Labels, `$actionContext`, & `send_data_model` ---


def test_non_latin_action_labels_preserve_action_ids() -> None:
    catalog = BasicCatalog("v1.0")
    expander = PatternExpander(
        MergedPatternLibrary.for_catalogs([catalog]),
        CatalogDecisionGraph([catalog]),
    )
    planner = LayoutPlanner()
    bindings = planner.bind_slots(
        planner.grammar.block("actions"),
        (),
        set(),
        actions=(
            ActionSpec(id="confirm_payment", label="支払いを確定"),
            ActionSpec(id="cancel_order", label="キャンセル"),
        ),
    )
    expanded = expander.expand_block(
        "actions",
        "actions",
        bindings,
        instances={"confirm_payment": {"primary": "true"}},
    )
    validate_payload([catalog], _wrap_surface(expanded.components))
    buttons = [c for c in expanded.components if c["component"] == "Button"]
    assert {b["action"]["event"]["name"] for b in buttons} == {
        "confirm_payment",
        "cancel_order",
    }
    texts = {c["text"] for c in expanded.components if c["component"] == "Text"}
    assert {"支払いを確定", "キャンセル"} <= texts


def test_action_context_explicit_item_key_and_form_submit_mutable_bindings() -> None:
    catalog = BasicCatalog("v1.0")
    expander = PatternExpander(
        MergedPatternLibrary.for_catalogs([catalog]),
        CatalogDecisionGraph([catalog]),
    )
    planner = LayoutPlanner()

    # 1. Explicit context pointers on ActionSpec
    explicit_bindings = planner.bind_slots(
        planner.grammar.block("actions"),
        (),
        set(),
        actions=(
            ActionSpec(
                id="approve_transfer",
                label="Approve",
                context={"transferId": "/transfer/id", "amount": "/transfer/amount"},
            ),
        ),
    )
    explicit_exp = expander.expand_block("actions", "actions", explicit_bindings)
    btn = next(c for c in explicit_exp.components if c["component"] == "Button")
    assert btn["action"] == {
        "event": {
            "name": "approve_transfer",
            "context": {
                "transferId": {"@path": "/transfer/id"},
                "amount": {"@path": "/transfer/amount"},
            },
        }
    }

    # 2. Scoped item action inside `$repeat`: uses `key` when given, else `id` when present
    flights_payload = {
        "flights": [
            {"id": "fl-1", "sku": "SKU-9", "title": "SFO -> NRT"},
        ]
    }
    flights_ptrs = inspect_payload_pointers(flights_payload)
    for act, expected_key in (
        (
            ActionSpec(id="book_flight", label="Book", scope="/flights", key="sku"),
            "sku",
        ),
        (
            ActionSpec(id="select_flight", label="Select", scope="/flights"),
            "id",
        ),
    ):
        col_bindings = planner.bind_slots(
            planner.grammar.block("collection"),
            flights_ptrs,
            set(),
            payload=flights_payload,
            actions=(act,),
        )
        col_exp = expander.expand_block(
            "collection",
            "collection",
            col_bindings,
            knobs={"layout": "rows", "trailing": "button", "trailing.label": act.label},
        )
        validate_payload([catalog], _wrap_surface(col_exp.components))
        item_btn = next(c for c in col_exp.components if c["component"] == "Button")
        assert item_btn["action"] == {
            "event": {
                "name": act.id,
                "context": {expected_key: {"@path": expected_key}},
            }
        }
        assert col_exp.send_data_model is False

    # 3. Form submit resolves `$actionContext` to all mutable form pointers
    submit_bindings = BlockBindings(
        slots={
            "buttons": SlotBinding(
                items=(
                    {
                        "action": SlotBinding(literal="save_profile"),
                        "label": SlotBinding(literal="Save"),
                    },
                )
            ),
            "$mutable": SlotBinding(
                fields={
                    "/profile/email": SlotBinding(pointer="/profile/email"),
                    "/profile/name": SlotBinding(pointer="/profile/name"),
                }
            ),
            "$plan_mutable": SlotBinding(literal=True),
        }
    )
    submit_exp = expander.expand_block("actions", "actions", submit_bindings)
    submit_btn = next(c for c in submit_exp.components if c["component"] == "Button")
    assert submit_btn["action"] == {
        "event": {
            "name": "save_profile",
            "context": {
                "email": {"@path": "/profile/email"},
                "name": {"@path": "/profile/name"},
            },
        }
    }
    assert submit_exp.send_data_model is False


def test_send_data_model_true_only_for_mutable_surface_with_empty_non_item_action() -> (
    None
):
    catalog = BasicCatalog("v1.0")
    expander = PatternExpander(
        MergedPatternLibrary.for_catalogs([catalog]),
        CatalogDecisionGraph([catalog]),
    )

    # Read-only surface + empty-context button -> send_data_model is False
    readonly_act = expander.expand_block(
        "actions",
        "actions",
        BlockBindings(
            slots={
                "buttons": SlotBinding(
                    items=(
                        {
                            "action": SlotBinding(literal="refresh"),
                            "label": SlotBinding(literal="Refresh"),
                        },
                    )
                )
            }
        ),
    )
    assert readonly_act.send_data_model is False

    # Mutable surface (`groups`) + empty-context surface button -> send_data_model is True
    groups_exp = expander.expand_block(
        "groups",
        "groups",
        BlockBindings(
            slots={
                "groups": SlotBinding(
                    items=(
                        {
                            "heading": SlotBinding(literal="Prefs"),
                            "rows": SlotBinding(
                                items=(
                                    {
                                        "label": SlotBinding(literal="Auto"),
                                        "value": SlotBinding(pointer="/prefs/auto"),
                                        "row_kind": SlotBinding(literal="switch"),
                                    },
                                )
                            ),
                        },
                    )
                )
            }
        ),
    )
    page_exp = expander.expand_page(
        PageBindings(title=SlotBinding(literal="Settings")),
        block_roots=["groups_root", "actions_root"],
        blocks=[groups_exp, readonly_act],
    )
    assert page_exp.send_data_model is True


# --- 9. Unbound Optional Slots & Stable IDs ---


def test_unbound_optional_slots_omitted_from_components_and_children() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    exp = expander.expand_block(
        "outcome",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(literal="Done")}),
    )
    by_id = {c["id"]: c for c in exp.components}
    assert "outcome_root" in by_id
    assert "outcome_headline" in by_id
    assert "outcome_detail" not in by_id
    assert "outcome_detail" not in by_id["outcome_root"]["children"]

    coll_exp = expander.expand_block(
        "collection",
        "collection",
        BlockBindings(
            slots={
                "items": SlotBinding(
                    items=(
                        {
                            "headline": SlotBinding(literal="Suite"),
                            "picture": SlotBinding(literal="https://example.com/1.jpg"),
                        },
                    )
                )
            }
        ),
        knobs={"layout": "cards", "trailing": "none"},
    )
    coll_by_id = {c["id"]: c for c in coll_exp.components}
    assert "collection_root" in coll_by_id
    assert "collection_0_item_supporting" not in coll_by_id
    assert "collection_0_item_footer" not in coll_by_id
    assert (
        "collection_0_item_footer"
        not in coll_by_id["collection_0_item_col"]["children"]
    )


# --- 10. Actions Button Ordering (`primaryLast` vs `primaryFirst`) ---


def test_actions_button_ordering_primary_last_and_primary_first() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    bindings = BlockBindings(
        slots={
            "buttons": SlotBinding(
                items=(
                    {
                        "action": SlotBinding(literal="send"),
                        "label": SlotBinding(literal="Send"),
                    },
                    {
                        "action": SlotBinding(literal="cancel"),
                        "label": SlotBinding(literal="Cancel"),
                    },
                )
            )
        }
    )

    for instances_arg in (
        {"send": {"primary": "true"}},
        {"Send": {"primary": "true"}},
        {"0": {"primary": "true"}},
    ):
        last_exp = expander.expand_block(
            "actions",
            "actions",
            bindings,
            {"order": "primaryLast"},
            instances_arg,
            "actions",
        )
        last_by_id = {c["id"]: c for c in last_exp.components}
        last_btn_ids = last_by_id["actions_root"]["children"]
        first_btn = last_by_id[last_btn_ids[0]]
        second_btn = last_by_id[last_btn_ids[1]]
        assert first_btn.get("variant") == "default"
        assert last_by_id[first_btn["child"]]["text"] == "Cancel"
        assert second_btn.get("variant") == "primary"
        assert last_by_id[second_btn["child"]]["text"] == "Send"

    first_exp = expander.expand_block(
        "actions",
        "actions",
        bindings,
        knobs={"order": "primaryFirst"},
        instances={"send": {"primary": "true"}},
    )
    first_by_id = {c["id"]: c for c in first_exp.components}
    first_btn_ids = first_by_id["actions_root"]["children"]
    assert first_by_id[first_btn_ids[0]].get("variant") == "primary"
    assert first_by_id[first_by_id[first_btn_ids[0]]["child"]]["text"] == "Send"
    assert first_by_id[first_btn_ids[1]].get("variant") == "default"
    assert first_by_id[first_by_id[first_btn_ids[1]]["child"]]["text"] == "Cancel"


# --- 11. Markdown Heading Escaping, `formatString`, & Fallback Walking ---


def test_markdown_heading_escapes_hash_and_newlines_and_emits_format_string() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    lit_exp = expander.expand_block(
        "outcome",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(literal="Room #4\nSuite")}),
    )
    lit_by_id = {c["id"]: c for c in lit_exp.components}
    title_text = lit_by_id["outcome_headline"]["text"]
    assert isinstance(title_text, str)
    assert "\n" not in title_text
    assert r"\#4" in title_text

    ptr_exp = expander.expand_block(
        "outcome",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(pointer="/name")}),
    )
    ptr_by_id = {c["id"]: c for c in ptr_exp.components}
    assert ptr_by_id["outcome_headline"]["text"] == {
        "@call": "formatString",
        "args": {"value": "## ${/name}"},
    }


def test_fallback_chain_walking_for_timeline_and_map() -> None:
    grammar = ArchetypeGrammar.default()
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    timeline_block = grammar.block("timeline")
    assert timeline_block is not None
    assert resolve_fallback_pattern(timeline_block, lib) == ResolvedPattern("steps")

    timeline_exp = expander.expand_block(
        "timeline",
        "timeline",
        BlockBindings(
            slots={
                "events": SlotBinding(
                    items=(
                        {
                            "title": SlotBinding(literal="Departed"),
                            "time": SlotBinding(literal="09:00"),
                        },
                    )
                )
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(timeline_exp.components))

    map_block = grammar.block("map")
    assert map_block is not None
    assert resolve_fallback_pattern(map_block, lib) == ResolvedPattern("facts")

    map_exp = expander.expand_block(
        "map",
        "map",
        BlockBindings(
            slots={
                "location": SlotBinding(literal="100 Main St"),
                "label": SlotBinding(literal="Address"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(map_exp.components))

    chart_block = grammar.block("chart")
    assert chart_block is not None
    assert resolve_fallback_pattern(chart_block, lib) == ResolvedPattern("headline")

    chart_exp = expander.expand_block(
        "chart",
        "chart",
        BlockBindings(
            slots={
                "series": SlotBinding(
                    items=(
                        {
                            "label": SlotBinding(literal="CPU"),
                            "value": SlotBinding(literal="78%"),
                        },
                    )
                )
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(chart_exp.components))

    raw_without_cmp = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    del raw_without_cmp["patterns"]["comparison"]
    lib_without_cmp = PatternLibrary.from_json(raw_without_cmp)
    cmp_block = grammar.block("comparison")
    assert cmp_block is not None
    assert resolve_fallback_pattern(cmp_block, lib_without_cmp) == ResolvedPattern(
        "collection", {"layout": "cards"}
    )
    exp_without_cmp = PatternExpander(lib_without_cmp, graph)
    fb_cmp_exp = exp_without_cmp.expand_block(
        "comparison",
        "comparison",
        BlockBindings(
            slots={
                "options": SlotBinding(
                    items=(
                        {
                            "headline": SlotBinding(literal="Pro"),
                            "highlight": SlotBinding(literal="$25/mo"),
                        },
                    )
                )
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(fb_cmp_exp.components))

    with pytest.raises(PatternError, match="not available"):
        expander.expand_block("unknown_block", "nonexistent_pattern", BlockBindings())


def test_by_type_honors_slot_binding_semantic_type_and_fallback_remaps() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    media_exp = expander.expand_block(
        "media",
        "media",
        BlockBindings(
            slots={
                "source": SlotBinding(
                    pointer="/stream/resource",
                    semantic_type=SemanticType.AUDIO_URL,
                ),
                "title": SlotBinding(literal="Episode 42"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(media_exp.components))
    assert any(c["component"] == "AudioPlayer" for c in media_exp.components)

    raw_no_hl_tl = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    del raw_no_hl_tl["patterns"]["headline"]
    del raw_no_hl_tl["patterns"]["steps"]
    exp_fallback = PatternExpander(PatternLibrary.from_json(raw_no_hl_tl), graph)

    hl_as_facts = exp_fallback.expand_block(
        "headline",
        "headline",
        BlockBindings(
            slots={
                "items": SlotBinding(
                    items=(
                        {
                            "label": SlotBinding(literal="CPU"),
                            "value": SlotBinding(literal="82%"),
                        },
                    )
                )
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(hl_as_facts.components))
    assert any(c.get("text") == "82%" for c in hl_as_facts.components)

    tl_as_col = exp_fallback.expand_block(
        "timeline",
        "timeline",
        BlockBindings(
            slots={
                "events": SlotBinding(
                    items=(
                        {
                            "title": SlotBinding(literal="Shipped"),
                            "time": SlotBinding(literal="10:00"),
                        },
                    )
                )
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(tl_as_col.components))
    assert any("Shipped" in str(c.get("text", "")) for c in tl_as_col.components)

    raw_pat = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    raw_pat["patterns"]["media"]["components"][0]["children"].append(
        {"id": "empty_sub"}
    )
    raw_pat["patterns"]["media"]["components"].append({
        "id": "empty_sub",
        "component": "Row",
        "children": [{"id": "opt_txt", "$if": "nonexistent_slot"}],
    })
    raw_pat["patterns"]["media"]["components"].append(
        {"id": "opt_txt", "component": "Text", "text": "Never"}
    )
    custom_exp = PatternExpander(PatternLibrary.from_json(raw_pat), graph)
    pruned_exp = custom_exp.expand_block(
        "media",
        "media",
        BlockBindings(slots={"source": SlotBinding(literal="https://a/b.mp4")}),
    )
    validate_payload([catalog], _wrap_surface(pruned_exp.components))
    defined_ids = {c["id"] for c in pruned_exp.components}
    for comp in pruned_exp.components:
        if isinstance(comp.get("children"), list):
            assert all(cid in defined_ids for cid in comp["children"])


def test_pattern_ref_parses_one_separator_and_libraries_reject_dotted_variants() -> (
    None
):
    assert PatternRef.parse("collection") == PatternRef("collection")
    assert PatternRef.parse("collection:grid") == PatternRef("collection", "grid")
    assert str(PatternRef("collection", "cards")) == "collection:cards"
    lib = MergedPatternLibrary.for_catalogs([BasicCatalog("v1.0")])
    assert lib.has_pattern("collection:cards")
    assert lib.has_pattern("collection", "cards")
    assert not lib.has_pattern("collection.cards")
    assert not hasattr(lib, "has")


def test_eligible_archetypes_is_pure_and_synthesizer_cache_is_per_instance() -> None:
    import a2ui.inference_formats.decision.patterns as patterns_module
    from a2ui.inference_formats.decision import DecisionSynthesizer

    assert not hasattr(patterns_module, "_ELIGIBILITY_CACHE")
    grammar = ArchetypeGrammar.default()
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    ptrs = inspect_payload_pointers(RESORT.payload)
    first = eligible_archetypes(grammar, lib, ptrs)
    assert first == eligible_archetypes(grammar, lib, ptrs)
    assert shape_signature(ptrs) == shape_signature(
        inspect_payload_pointers(RESORT.payload)
    )

    synth_a = DecisionSynthesizer([catalog], mock_backend())
    synth_b = DecisionSynthesizer([catalog], mock_backend())
    assert synth_a._eligible_archetypes(ptrs) == first
    assert synth_a._eligibility_cache is not synth_b._eligibility_cache
    assert len(synth_b._eligibility_cache) == 0


def test_is_self_author_resolves_item_qualified_instance_keys() -> None:
    catalog = BasicCatalog("v1.0")
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(MergedPatternLibrary.for_catalogs([catalog]), graph)
    exp = expander.expand_block(
        "conversation",
        "conversation",
        BlockBindings(
            slots={
                "messages": SlotBinding(
                    items=(
                        {
                            "author": SlotBinding(literal="Alex"),
                            "text": SlotBinding(literal="Hi there"),
                        },
                    )
                )
            }
        ),
        instances={"0": {"self": "Alex"}},
    )
    validate_payload([catalog], _wrap_surface(exp.components))
    assert any(
        c["id"] == "conversation_msg_0" and c.get("justify") == "end"
        for c in exp.components
    )


def test_region_expand_block_preserves_stable_component_ids_single_and_multi_catalog() -> (
    None
):
    """Standalone `expand_block` for a region update emits the exact same component IDs as full expansion."""
    import asyncio
    from .layout_fixtures import ScriptedAnswers

    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)
    planner = LayoutPlanner(capabilities=lib)

    ptrs = inspect_payload_pointers(HOST.payload)
    batch, state = planner.build_batch(HOST.intent, ptrs, payload=HOST.payload)
    answers = asyncio.run(
        ScriptedAnswers({
            "family": ("monitor", 0.90),
            "archetype:monitor": ("dashboard", 0.85),
            "gate:banner": 0.85,
            "gate:headline": 0.90,
            "gate:facts": 0.80,
            "salience:/cpu": 2.9,
            "salience:/status": 2.1,
            "salience:/uptimeHours": 1.4,
            "salience:/host": 0.5,
            "instance:banner.tone:/status": ("warning", 0.90),
            "instance:headline.news:/cpu": ("bad", 0.85),
        })
        .backend()
        .answer(batch)
    )
    outcome = planner.read(state, answers)
    assert outcome.plan is not None
    plan = outcome.plan

    # Full expansion (same sequence used by `DecisionSynthesizer._expand_plan`)
    full_by_block: dict[str, list[str]] = {}
    block_roots: list[str] = []
    block_exps = []
    for blk in plan.blocks:
        exp = expander.expand_block(
            blk.block_id,
            blk.pattern,
            blk.bindings,
            knobs=blk.variant_knobs,
            instances=blk.instances,
            id_prefix=blk.block_id,
        )
        full_by_block[blk.block_id] = [c["id"] for c in exp.components]
        block_roots.append(exp.components[0]["id"])
        block_exps.append(exp)
    page_exp = expander.expand_page(
        plan.page, block_roots=block_roots, blocks=block_exps
    )
    assert page_exp.components[0]["id"] == "root"

    # Standalone region `expand_block` with default `id_prefix=""`, `block_id`, or `<block_id>_root`
    for blk in plan.blocks:
        for prefix_arg in ("", blk.block_id, f"{blk.block_id}_root"):
            region_exp = expander.expand_block(
                blk.block_id,
                blk.pattern,
                blk.bindings,
                knobs=blk.variant_knobs,
                instances=blk.instances,
                id_prefix=prefix_arg,
            )
            assert [c["id"] for c in region_exp.components] == full_by_block[
                blk.block_id
            ]
            assert region_exp.components[0]["id"] == f"{blk.block_id}_root"
            validate_payload([catalog], _wrap_surface(region_exp.components))

    # Multi-catalog surface (`graph.surface_catalog_id is None`): default prefix includes catalog slug
    domain_cat = _two_component_domain_catalog()
    domain_lib = PatternLibrary.from_json({
        "grammarVersion": "1",
        "catalogId": domain_cat.catalog_id,
        "patterns": {
            "banner": {
                "slots": ["title"],
                "root": "alert_root",
                "components": [
                    {
                        "id": "alert_root",
                        "component": "AlertFrame",
                        "child": "alert_badge",
                    },
                    {
                        "id": "alert_badge",
                        "component": "TelemetryBadge",
                        "metric": {"$slot": "title", "$default": "ok"},
                    },
                ],
            }
        },
    })
    basic_lib = PatternLibrary.from_json(
        copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    )
    multi_lib = MergedPatternLibrary([domain_lib, basic_lib])
    multi_graph = CatalogDecisionGraph([domain_cat, catalog])
    assert multi_graph.surface_catalog_id is None
    multi_expander = PatternExpander(multi_lib, multi_graph)

    multi_banner = multi_expander.expand_block(
        "banner",
        "banner",
        BlockBindings(slots={"title": SlotBinding(pointer="/status")}),
    )
    assert [c["id"] for c in multi_banner.components] == [
        "telemetry_banner_root",
        "telemetry_banner_alert_badge",
    ]
    assert all(
        c.get("@catalogId") == domain_cat.catalog_id for c in multi_banner.components
    )


def test_form_field_variants_all_emit_required_checks_with_at_call() -> None:
    catalog = BasicCatalog("v1.0")
    lib = MergedPatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)
    controls = (
        "shortText",
        "longText",
        "number",
        "obscured",
        "toggle",
        "choice",
        "multiChoice",
        "range",
        "date",
    )
    items = tuple(
        {
            "label": SlotBinding(literal=f"Field {idx}"),
            "value": SlotBinding(pointer=f"/f{idx}"),
            "options": SlotBinding(literal=[{"label": "Alpha", "value": "A"}]),
            "min": SlotBinding(literal=0),
            "max": SlotBinding(literal=100),
            "control": SlotBinding(literal=ctrl),
        }
        for idx, ctrl in enumerate(controls)
    )
    instances = {str(idx): {"required": "true"} for idx in range(len(controls))}
    exp = expander.expand_block(
        "form",
        "form",
        BlockBindings(slots={"fields": SlotBinding(items=items)}),
        instances=instances,
    )
    validate_payload([catalog], _wrap_surface(exp.components))
    field_comps = [c for c in exp.components if c["id"] != "form_root"]
    assert len(field_comps) == len(controls)
    for comp in field_comps:
        assert comp["@checks"] == [{
            "condition": {
                "@call": "required",
                "args": {"value": comp["value"]},
            },
            "message": "Required",
        }]


def test_stamp_function_calls_and_hatch_build_hook_empty_build_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import importlib.util
    from pathlib import Path
    import sys
    import types
    from a2ui.inference_formats.decision.synthesizer import _stamp_function_calls

    payload = {
        "component": "TextField",
        "label": "Name",
        "count": 3,
        "@checks": [
            {
                "condition": {"@call": "required", "args": {"value": {"@path": "/n"}}},
                "message": "Required",
            },
            {
                "condition": {
                    "@call": "email",
                    "args": {"value": {"@path": "/n"}},
                    "catalogId": "https://existing.example/cat",
                }
            },
        ],
    }
    _stamp_function_calls(payload, "https://default.example/cat")
    assert (
        payload["@checks"][0]["condition"]["catalogId"]  # type: ignore[index]
        == "https://default.example/cat"
    )
    assert (
        payload["@checks"][1]["condition"]["catalogId"]  # type: ignore[index]
        == "https://existing.example/cat"
    )

    fake_iface = types.ModuleType("hatchling.builders.hooks.plugin.interface")
    fake_iface.BuildHookInterface = object  # type: ignore[attr-defined]
    for mod_name in (
        "hatchling",
        "hatchling.builders",
        "hatchling.builders.hooks",
        "hatchling.builders.hooks.plugin",
    ):
        monkeypatch.setitem(sys.modules, mod_name, types.ModuleType(mod_name))
    monkeypatch.setitem(
        sys.modules, "hatchling.builders.hooks.plugin.interface", fake_iface
    )

    hook_path = Path(__file__).resolve().parents[2] / "hatch_build.py"
    spec = importlib.util.spec_from_file_location("a2ui_agent_hatch_build", hook_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    hook = object.__new__(module.DecisionAssetsBuildHook)
    hook.root = str(hook_path.parent)
    build_data: dict[str, Any] = {}
    hook.initialize("0.1.0", build_data)
    assert "force_include" in build_data
    assert len(build_data["force_include"]) == 4
