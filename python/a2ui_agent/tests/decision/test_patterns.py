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

import copy
from typing import Any

import pytest

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision.archetypes import (
    ArchetypeGrammar,
    load_asset,
)
from a2ui.inference_formats.decision.catalog_graph import CatalogDecisionGraph
from a2ui.inference_formats.decision.models import (
    BlockBindings,
    PageBindings,
    SlotBinding,
)
from a2ui.inference_formats.decision.patterns import (
    MergedPatternLibrary,
    PatternError,
    PatternExpander,
    PatternLibrary,
    eligible_archetypes,
    resolve_fallback_pattern,
)
from a2ui.inference_formats.decision.payload_inspector import (
    inspect_payload_pointers,
)
from a2ui.utils import validate_payload

from .layout_fixtures import HOST, RESORT, SETTINGS, TRANSFER


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


def _wrap_surface(
    components: list[dict[str, Any]], *, version: str = "1.0"
) -> list[dict[str, Any]]:
    """Wraps expanded `components` in a valid `createSurface` + `updateComponents` envelope."""
    has_root = any(c.get("id") == "root" for c in components)
    all_comps = list(components)
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
    catalog_id = BasicCatalog("v1.0" if version == "1.0" else "v0.9").catalog_id
    return [
        {
            "version": f"v{version}",
            "createSurface": {
                "surfaceId": "test_surface",
                "catalogId": catalog_id,
            },
        },
        {
            "version": f"v{version}",
            "updateComponents": {
                "surfaceId": "test_surface",
                "components": all_comps,
            },
        },
    ]


# --- 1. Schema Rejection of Malformed Pattern Files ---


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


# --- 2 & 3. Catalog Matching & Pattern Capabilities ---


def test_for_catalogs_matches_v1_0_and_v0_9_basic_catalogs() -> None:
    lib_v10 = PatternLibrary.for_catalogs([BasicCatalog("v1.0")])
    lib_v09 = PatternLibrary.for_catalogs([BasicCatalog("v0.9")])

    for lib in (lib_v10, lib_v09):
        assert lib.has("page")
        assert lib.has("headline")
        assert lib.has("collection", "rows")
        assert lib.has("collection", "cards")
        assert lib.has("collection", "reel")
        assert lib.has_pattern("collection.cards")
        assert lib.has_pattern("collection:reel")
        assert not lib.has("collection", "grid")
        assert not lib.has_pattern("collection.grid")
        assert not lib.has("chart")
        assert not lib.has("timeline")
        assert not lib.has("map")


# --- 4. Multi-Catalog Merge & Primary Catalog Precedence ---


def test_multi_catalog_merge_and_primary_precedence() -> None:
    basic_raw = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    basic_lib = PatternLibrary.from_json(basic_raw)

    domain_raw = {
        "version": "1",
        "catalogIds": ["https://example.com/catalogs/domain/v1/catalog.json"],
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
                "slots": ["headline"],
                "root": "domain_headline",
                "components": [{
                    "id": "domain_headline",
                    "component": "Text",
                    "text": {"$slot": "headline"},
                }],
            },
        },
    }
    domain_lib = PatternLibrary.from_json(domain_raw)

    merged_domain_first = MergedPatternLibrary([domain_lib, basic_lib])
    assert merged_domain_first.has("chart")
    assert merged_domain_first.has("facts")
    assert (
        merged_domain_first.owner_catalog_id("headline")
        == "https://example.com/catalogs/domain/v1/catalog.json"
    )
    headline_pat = merged_domain_first.get("headline")
    assert headline_pat is not None
    assert headline_pat.variants[0].root == "domain_headline"

    merged_basic_first = MergedPatternLibrary([basic_lib, domain_lib])
    assert merged_basic_first.has("chart")
    assert merged_basic_first.owner_catalog_id("headline") == basic_lib.catalog_id
    basic_headline = merged_basic_first.get("headline")
    assert basic_headline is not None
    assert basic_headline.variants[0].root == "headline_row"


# --- 5 & 6. Eligibility across Fixtures & Domain Catalogs ---


def test_eligibility_on_four_layout_fixtures_against_basic_v1() -> None:
    grammar = ArchetypeGrammar.default()
    lib = PatternLibrary.for_catalogs([BasicCatalog("v1.0")])

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

    # `grid` is not offered by basic_v1_0.json on collection
    assert not lib.has_pattern("collection", "grid")
    assert eligible_archetypes(grammar, lib, ()) == ()


def test_eligibility_two_component_domain_catalog_has_zero_archetypes() -> None:
    grammar = ArchetypeGrammar.default()
    domain_cat = _two_component_domain_catalog()
    lib = PatternLibrary.for_catalogs([domain_cat])

    for fixture in (RESORT, HOST, TRANSFER, SETTINGS):
        ptrs = inspect_payload_pointers(
            fixture.payload, mutable_paths=fixture.mutable_paths
        )
        assert eligible_archetypes(grammar, lib, ptrs) == ()


# --- 7. Expander on Every Basic v1 Pattern (v1.0 & v0.9 Validation) ---


@pytest.mark.parametrize("version", ["1.0", "0.9"])
def test_expand_every_basic_v1_pattern_validates(version: str) -> None:
    catalog = BasicCatalog(f"v{version}")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    # 1. banner
    banner_comps = expander.expand_block(
        "banner",
        "banner",
        BlockBindings(slots={"message": SlotBinding(pointer="/notice")}),
        knobs={"tone": "warning"},
    )
    validate_payload([catalog], _wrap_surface(banner_comps, version=version))

    # 2. picture (single & gallery)
    pic_single = expander.expand_block(
        "hero_media",
        "picture",
        BlockBindings(
            slots={
                "source": SlotBinding(pointer="/photos/0/url"),
                "caption": SlotBinding(literal="Pool at dusk"),
            }
        ),
        knobs={"count": "single"},
    )
    validate_payload([catalog], _wrap_surface(pic_single, version=version))

    pic_gallery = expander.expand_block(
        "hero_media",
        "picture",
        BlockBindings(
            slots={
                "source": SlotBinding(
                    pointer="/photos",
                    fields={"source": SlotBinding(pointer="/url")},
                ),
                "caption": SlotBinding(literal="Gallery"),
            }
        ),
        knobs={"count": "gallery"},
    )
    validate_payload([catalog], _wrap_surface(pic_gallery, version=version))

    # 3. media (video & audio)
    media_video = expander.expand_block(
        "player",
        "media",
        BlockBindings(
            slots={
                "source": SlotBinding(literal="https://example.com/clip.mp4"),
                "poster": SlotBinding(literal="https://example.com/poster.jpg"),
                "caption": SlotBinding(literal="Keynote"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(media_video, version=version))

    media_audio = expander.expand_block(
        "player",
        "media",
        BlockBindings(
            slots={
                "source": SlotBinding(literal="https://example.com/ep1.mp3"),
                "caption": SlotBinding(literal="Episode 1"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(media_audio, version=version))

    # 4. filters (tabs & chips)
    for style in ("tabs", "chips"):
        filters_comps = expander.expand_block(
            "filter_bar",
            "filters",
            BlockBindings(
                slots={
                    "query": SlotBinding(pointer="/query"),
                    "categories": SlotBinding(
                        literal=["All", "Active"],
                        fields={"selected": SlotBinding(pointer="/selected")},
                    ),
                }
            ),
            knobs={"style": style},
        )
        validate_payload([catalog], _wrap_surface(filters_comps, version=version))

    # 5. headline
    headline_comps = expander.expand_block(
        "header",
        "headline",
        BlockBindings(
            slots={
                "headline": SlotBinding(pointer="/name"),
                "subhead": SlotBinding(literal=" Boutique Resort"),
                "eyebrow": SlotBinding(literal="Featured"),
                "status": SlotBinding(literal="Open"),
                "icon": SlotBinding(literal="star"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(headline_comps, version=version))

    # 6. facts
    facts_comps = expander.expand_block(
        "key_facts",
        "facts",
        BlockBindings(
            slots={
                "rows": SlotBinding(
                    items=(
                        {
                            "label": SlotBinding(literal="CPU"),
                            "value": SlotBinding(pointer="/cpu"),
                            "note": SlotBinding(pointer="/cpuDelta"),
                        },
                        {
                            "label": SlotBinding(literal="Host"),
                            "value": SlotBinding(pointer="/host"),
                        },
                    )
                )
            }
        ),
        instances={"prominent:0": "true"},
    )
    validate_payload([catalog], _wrap_surface(facts_comps, version=version))

    # 7. prose
    prose_comps = expander.expand_block(
        "body_copy",
        "prose",
        BlockBindings(
            slots={
                "title": SlotBinding(literal="Overview"),
                "body": SlotBinding(pointer="/about"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(prose_comps, version=version))

    # 8. collection (rows, cards, reel)
    for layout_knob in ("rows", "cards", "reel"):
        coll_comps = expander.expand_block(
            "items_list",
            "collection",
            BlockBindings(
                slots={
                    "items": SlotBinding(
                        pointer="/photos",
                        fields={
                            "headline": SlotBinding(pointer="/caption"),
                            "picture": SlotBinding(pointer="/url"),
                            "supporting": SlotBinding(literal="View details"),
                        },
                    )
                }
            ),
            knobs={"layout": layout_knob, "trailing": "button"},
        )
        validate_payload([catalog], _wrap_surface(coll_comps, version=version))

    # 9. comparison
    comp_comps = expander.expand_block(
        "options_table",
        "comparison",
        BlockBindings(
            slots={
                "options": SlotBinding(
                    items=(
                        {
                            "title": SlotBinding(literal="Basic"),
                            "price": SlotBinding(literal="$10"),
                            "action": SlotBinding(literal="Choose Basic"),
                        },
                        {
                            "title": SlotBinding(literal="Pro"),
                            "price": SlotBinding(literal="$25"),
                            "highlight": SlotBinding(literal="Popular"),
                            "action": SlotBinding(literal="Choose Pro"),
                        },
                    )
                )
            }
        ),
        instances={"recommended:1": "true"},
    )
    validate_payload([catalog], _wrap_surface(comp_comps, version=version))

    # 10. steps
    steps_comps = expander.expand_block(
        "progress_steps",
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
    validate_payload([catalog], _wrap_surface(steps_comps, version=version))

    # 11. form (all 9 fieldVariants)
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
            "options": SlotBinding(literal=["A", "B"]),
            "control": SlotBinding(literal=control),
        })
    form_comps = expander.expand_block(
        "input_fields",
        "form",
        BlockBindings(slots={"fields": SlotBinding(items=tuple(form_items))}),
    )
    validate_payload([catalog], _wrap_surface(form_comps, version=version))
    form_comp_types = {c["component"] for c in form_comps}
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
    groups_comps = expander.expand_block(
        "setting_groups",
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
    validate_payload([catalog], _wrap_surface(groups_comps, version=version))
    groups_comp_types = {c["component"] for c in groups_comps}
    assert {"CheckBox", "Button", "Text"} <= groups_comp_types

    # 13. actions
    actions_comps = expander.expand_block(
        "action_bar",
        "actions",
        BlockBindings(
            slots={
                "buttons": SlotBinding(
                    items=(
                        {"label": SlotBinding(literal="Send")},
                        {"label": SlotBinding(literal="Cancel")},
                    )
                )
            }
        ),
        knobs={"order": "primaryLast"},
        instances={"primary:0": "true"},
    )
    validate_payload([catalog], _wrap_surface(actions_comps, version=version))

    # 14. outcome
    outcome_comps = expander.expand_block(
        "outcome_banner",
        "outcome",
        BlockBindings(
            slots={
                "headline": SlotBinding(literal="Transfer Complete"),
                "detail": SlotBinding(literal="Ref #1024"),
                "status": SlotBinding(literal="success"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(outcome_comps, version=version))

    # 15. conversation
    conv_comps = expander.expand_block(
        "messages",
        "conversation",
        BlockBindings(
            slots={
                "messages": SlotBinding(
                    items=(
                        {
                            "author": SlotBinding(literal="Alex"),
                            "body": SlotBinding(literal="Hello!"),
                            "time": SlotBinding(literal="10:00"),
                        },
                        {
                            "author": SlotBinding(literal="me"),
                            "body": SlotBinding(literal="Hi Alex!"),
                            "time": SlotBinding(literal="10:01"),
                        },
                    )
                ),
                "suggestions": SlotBinding(
                    items=({"label": SlotBinding(literal="Thanks!")},)
                ),
            }
        ),
        knobs={"self": "me"},
    )
    validate_payload([catalog], _wrap_surface(conv_comps, version=version))

    # 16. compose
    compose_comps = expander.expand_block(
        "composer",
        "compose",
        BlockBindings(
            slots={
                "input": SlotBinding(pointer="/draft"),
                "placeholder": SlotBinding(literal="Reply"),
                "submit": SlotBinding(literal="Send"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(compose_comps, version=version))

    # 17. page (default & dialog)
    for dialog in (False, True):
        page_comps = expander.expand_page(
            PageBindings(
                title=SlotBinding(literal="Casa Verde"),
                subtitle=SlotBinding(literal="Hillside Resort"),
                mark=SlotBinding(literal="home"),
                dialog=dialog,
            ),
            block_roots=[headline_comps[0]["id"]],
        )
        validate_payload(
            [catalog],
            _wrap_surface(page_comps + headline_comps, version=version),
        )


# --- 8. Unbound Optional Slots Omit Child Component & Parent Reference ---


def test_unbound_optional_slots_omitted_from_components_and_children() -> None:
    catalog = BasicCatalog("v1.0")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    # Expand `outcome` with ONLY `headline` bound (`detail` unbound)
    comps = expander.expand_block(
        "outcome_block",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(literal="Done")}),
    )
    by_id = {c["id"]: c for c in comps}
    assert "outcome_block_outcome_headline" in by_id
    assert "outcome_block_outcome_detail" not in by_id
    root_children = by_id["outcome_block_outcome_col"]["children"]
    assert "outcome_block_outcome_detail" not in root_children

    # Expand `collection` (`cards`) with `meta`, `rating`, `trailing` unbound -> `item_footer` pruned
    coll_comps = expander.expand_block(
        "cards_block",
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
    coll_by_id = {c["id"]: c for c in coll_comps}
    assert "cards_block_0_item_supporting" not in coll_by_id
    assert "cards_block_0_item_footer" not in coll_by_id
    assert (
        "cards_block_0_item_footer"
        not in coll_by_id["cards_block_0_item_col"]["children"]
    )


# --- 9. Actions Button Ordering (`primaryLast` vs `primaryFirst`) ---


def test_actions_button_ordering_primary_last_and_primary_first() -> None:
    catalog = BasicCatalog("v1.0")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph, is_v10=True)

    bindings = BlockBindings(
        slots={
            "buttons": SlotBinding(
                items=(
                    {"label": SlotBinding(literal="Send")},
                    {"label": SlotBinding(literal="Cancel")},
                )
            )
        }
    )

    for instances_arg in (
        {"primary": "Send"},
        {"Send": {"primary": "true"}},
        {"0": {"primary": "true"}},
    ):
        last_comps = expander.expand_block(
            "action_bar",
            "actions",
            bindings,
            {"order": "primaryLast"},
            instances_arg,
            "action_bar",
        )
        last_by_id = {c["id"]: c for c in last_comps}
        last_btn_ids = last_by_id["action_bar_actions_row"]["children"]
        first_btn = last_by_id[last_btn_ids[0]]
        second_btn = last_by_id[last_btn_ids[1]]
        assert first_btn.get("variant") == "default"
        assert last_by_id[first_btn["child"]]["text"] == "Cancel"
        assert second_btn.get("variant") == "primary"
        assert last_by_id[second_btn["child"]]["text"] == "Send"

    first_comps = expander.expand_block(
        "action_bar",
        "actions",
        bindings,
        knobs={"order": "primaryFirst"},
        instances={"0": {"primary": "true"}},
    )
    first_by_id = {c["id"]: c for c in first_comps}
    first_btn_ids = first_by_id["action_bar_actions_row"]["children"]
    assert first_by_id[first_btn_ids[0]].get("variant") == "primary"
    assert first_by_id[first_by_id[first_btn_ids[0]]["child"]]["text"] == "Send"
    assert first_by_id[first_btn_ids[1]].get("variant") == "default"
    assert first_by_id[first_by_id[first_btn_ids[1]]["child"]]["text"] == "Cancel"


# --- 10. v0.9 Catalog `$repeat` Template ChildList & Binding Syntax ---


def test_v09_repeat_template_child_list_and_bindings() -> None:
    catalog = BasicCatalog("v0.9")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    comps = expander.expand_block(
        "items_list",
        "collection",
        BlockBindings(
            slots={
                "items": SlotBinding(
                    pointer="/photos",
                    fields={
                        "headline": SlotBinding(pointer="/caption"),
                        "picture": SlotBinding(pointer="/url"),
                    },
                )
            }
        ),
        knobs={"layout": "cards"},
    )
    by_id = {c["id"]: c for c in comps}
    list_comp = by_id["items_list_list"]
    assert list_comp["children"] == {
        "path": "/photos",
        "componentId": "items_list_item",
    }
    img_comp = by_id["items_list_item_img"]
    assert img_comp["url"] == {"path": "url"}
    title_comp = by_id["items_list_item_headline"]
    assert title_comp["text"] == {
        "call": "formatString",
        "args": {"value": "**${caption}**"},
    }
    validate_payload([catalog], _wrap_surface(comps, version="0.9"))


# --- 11. Markdown Heading Escaping, `formatString`, & Fallback Walking ---


def test_markdown_heading_escapes_hash_and_newlines_and_emits_format_string() -> None:
    catalog = BasicCatalog("v1.0")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    # Literal with `#` and newline inside a `## {headline}` template (`outcome`)
    lit_comps = expander.expand_block(
        "header",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(literal="Room #4\nSuite")}),
    )
    lit_by_id = {c["id"]: c for c in lit_comps}
    title_text = lit_by_id["header_outcome_headline"]["text"]
    assert isinstance(title_text, str)
    assert "\n" not in title_text
    assert r"\#4" in title_text

    # Bound pointer inside `## {headline}` emits `formatString` function call
    ptr_comps = expander.expand_block(
        "header",
        "outcome",
        BlockBindings(slots={"headline": SlotBinding(pointer="/name")}),
    )
    ptr_by_id = {c["id"]: c for c in ptr_comps}
    assert ptr_by_id["header_outcome_headline"]["text"] == {
        "@call": "formatString",
        "args": {"value": "## ${/name}"},
    }


def test_fallback_chain_walking_for_timeline_and_map() -> None:
    grammar = ArchetypeGrammar.default()
    catalog = BasicCatalog("v1.0")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    timeline_block = grammar.block("timeline")
    assert timeline_block is not None
    assert resolve_fallback_pattern(timeline_block, lib) == ("steps", {})

    timeline_comps = expander.expand_block(
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
    validate_payload([catalog], _wrap_surface(timeline_comps))

    map_block = grammar.block("map")
    assert map_block is not None
    assert resolve_fallback_pattern(map_block, lib) == ("facts", {})

    map_comps = expander.expand_block(
        "map",
        "map",
        BlockBindings(
            slots={
                "location": SlotBinding(literal="100 Main St"),
                "label": SlotBinding(literal="Address"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(map_comps))

    chart_block = grammar.block("chart")
    assert chart_block is not None
    assert resolve_fallback_pattern(chart_block, lib) == ("headline", {})

    chart_comps = expander.expand_block(
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
    validate_payload([catalog], _wrap_surface(chart_comps))

    # Fallback when `comparison` is absent -> `collection:cards`
    raw_without_cmp = copy.deepcopy(load_asset("patterns/basic_v1_0.json"))
    del raw_without_cmp["patterns"]["comparison"]
    lib_without_cmp = PatternLibrary.from_json(raw_without_cmp)
    cmp_block = grammar.block("comparison")
    assert cmp_block is not None
    assert resolve_fallback_pattern(cmp_block, lib_without_cmp) == (
        "collection",
        {"layout": "cards"},
    )
    exp_without_cmp = PatternExpander(lib_without_cmp, graph)
    fb_cmp_comps = exp_without_cmp.expand_block(
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
    validate_payload([catalog], _wrap_surface(fb_cmp_comps))

    with pytest.raises(PatternError, match="not available"):
        expander.expand_block("unknown_block", "nonexistent_pattern", BlockBindings())


def test_by_type_honors_slot_binding_semantic_type_and_fallback_remaps() -> None:
    """Tests `SlotBinding.semantic_type` dispatch (H2), root pruning (M4), and fallback slot adaptation (M5)."""
    catalog = BasicCatalog("v1.0")
    lib = PatternLibrary.for_catalogs([catalog])
    graph = CatalogDecisionGraph([catalog])
    expander = PatternExpander(lib, graph)

    # H2: /stream/resource has no audio/video substring in the path, but carries semantic_type="audio"
    media_comps = expander.expand_block(
        "player",
        "media",
        BlockBindings(
            slots={
                "source": SlotBinding(
                    pointer="/stream/resource",
                    semantic_type="audio",
                ),
                "caption": SlotBinding(literal="Episode 42"),
            }
        ),
    )
    validate_payload([catalog], _wrap_surface(media_comps))
    assert any(c["component"] == "AudioPlayer" for c in media_comps)

    # M5: headline -> facts fallback remaps `items` -> `rows`, and timeline -> collection remaps `title` -> `headline`
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
    validate_payload([catalog], _wrap_surface(hl_as_facts))
    assert any(c.get("text") == "82%" for c in hl_as_facts)

    # M5: timeline -> collection fallback remaps `title` -> `headline`
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
    validate_payload([catalog], _wrap_surface(tl_as_col))
    assert any("Shipped" in str(c.get("text", "")) for c in tl_as_col)

    # M4: empty container child of pattern root is pruned from root["children"]
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
    custom_lib = PatternLibrary.from_json(raw_pat)
    custom_exp = PatternExpander(custom_lib, graph)
    pruned_comps = custom_exp.expand_block(
        "media",
        "media",
        BlockBindings(slots={"source": SlotBinding(literal="https://a/b.mp4")}),
    )
    validate_payload([catalog], _wrap_surface(pruned_comps))
    defined_ids = {c["id"] for c in pruned_comps}
    for comp in pruned_comps:
        if isinstance(comp.get("children"), list):
            assert all(cid in defined_ids for cid in comp["children"])
