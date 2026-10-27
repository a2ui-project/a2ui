# Copyright 2026 Google LLC
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

"""Shared custom catalog, pattern, template, and payload fixtures for skill tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
from typing import Any

from a2ui.core import Catalog

REPO_ROOT = Path(__file__).resolve().parents[4]
SKILL_DIR = REPO_ROOT / ".agents" / "skills" / "a2ui-generate-catalog-patterns"
SKILL_SCRIPTS_DIR = SKILL_DIR / "scripts"

DESIGN_SYSTEM_CATALOG_ID = "https://example.com/catalogs/design_system/v1/catalog.json"
FIXED_FORMS_CATALOG_ID = "https://example.com/catalogs/fixed_forms/v1/catalog.json"
HYBRID_CATALOG_ID = "https://example.com/catalogs/hybrid/v1/catalog.json"


def ensure_scripts_on_path() -> None:
    """Adds `.agents/skills/a2ui-generate-catalog-patterns/scripts` to `sys.path`."""
    scripts_str = str(SKILL_SCRIPTS_DIR)
    if scripts_str not in sys.path:
        sys.path.insert(0, scripts_str)


def _design_system_components() -> dict[str, Any]:
    """Returns component definitions for the composable design-system catalog."""
    return {
        "Stack": {
            "type": "object",
            "description": "Vertical or horizontal flex container.",
            "properties": {
                "component": {"const": "Stack"},
                "children": {"$ref": "common_types.json#/$defs/ChildList"},
                "direction": {
                    "type": "string",
                    "enum": ["vertical", "horizontal"],
                },
            },
            "required": ["component", "children"],
        },
        "Panel": {
            "type": "object",
            "description": "Bordered surface container with optional heading.",
            "properties": {
                "component": {"const": "Panel"},
                "heading": {"$ref": "common_types.json#/$defs/DynamicString"},
                "body": {"$ref": "common_types.json#/$defs/ComponentId"},
            },
            "required": ["component", "body"],
        },
        "Label": {
            "type": "object",
            "description": "Typography leaf with tone variants.",
            "properties": {
                "component": {"const": "Label"},
                "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                "tone": {
                    "type": "string",
                    "enum": ["muted", "normal", "critical"],
                },
            },
            "required": ["component", "text"],
        },
        "Figure": {
            "type": "object",
            "description": "Image figure with optional caption.",
            "properties": {
                "component": {"const": "Figure"},
                "src": {"$ref": "common_types.json#/$defs/DynamicString"},
                "caption": {"$ref": "common_types.json#/$defs/DynamicString"},
            },
            "required": ["component", "src"],
        },
        "Stat": {
            "type": "object",
            "description": "Metric tile showing a label and numeric value.",
            "properties": {
                "component": {"const": "Stat"},
                "label": {"$ref": "common_types.json#/$defs/DynamicString"},
                "value": {"$ref": "common_types.json#/$defs/DynamicString"},
            },
            "required": ["component", "label", "value"],
        },
        "Entry": {
            "type": "object",
            "description": "Editable text input field.",
            "allOf": [
                {"$ref": "common_types.json#/$defs/Checkable"},
                {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Entry"},
                        "label": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "value": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "placeholder": {
                            "$ref": "common_types.json#/$defs/DynamicString"
                        },
                    },
                    "required": ["component", "label", "value"],
                },
            ],
        },
        "Trigger": {
            "type": "object",
            "description": "Interactive action trigger button.",
            "properties": {
                "component": {"const": "Trigger"},
                "label": {"$ref": "common_types.json#/$defs/DynamicString"},
                "onPress": {"$ref": "common_types.json#/$defs/Action"},
            },
            "required": ["component", "label", "onPress"],
        },
    }


def _fixed_forms_components() -> dict[str, Any]:
    """Returns three monolithic form components with no child slots."""
    return {
        "OrderEntryTicket": {
            "type": "object",
            "description": "Mutable order entry ticket for equity trades.",
            "allOf": [
                {"$ref": "common_types.json#/$defs/Checkable"},
                {
                    "type": "object",
                    "properties": {
                        "component": {"const": "OrderEntryTicket"},
                        "symbol": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "shares": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                        "submitOrder": {"$ref": "common_types.json#/$defs/Action"},
                    },
                    "required": [
                        "component",
                        "symbol",
                        "shares",
                        "submitOrder",
                    ],
                },
            ],
        },
        "WireTransferForm": {
            "type": "object",
            "description": "Domestic or international wire transfer form.",
            "properties": {
                "component": {"const": "WireTransferForm"},
                "beneficiary": {"$ref": "common_types.json#/$defs/DynamicString"},
                "routingNumber": {"$ref": "common_types.json#/$defs/DynamicString"},
                "amount": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                "sendWire": {"$ref": "common_types.json#/$defs/Action"},
            },
            "required": [
                "component",
                "beneficiary",
                "routingNumber",
                "amount",
                "sendWire",
            ],
        },
        "TaxWithholdingForm": {
            "type": "object",
            "description": "Tax withholding election form.",
            "properties": {
                "component": {"const": "TaxWithholdingForm"},
                "filingStatus": {"$ref": "common_types.json#/$defs/DynamicString"},
                "allowances": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                "saveElection": {"$ref": "common_types.json#/$defs/Action"},
            },
            "required": [
                "component",
                "filingStatus",
                "allowances",
                "saveElection",
            ],
        },
    }


def _standard_functions(protocol_version: str) -> dict[str, Any]:
    """Returns `formatString` function schema so `$text` directives validate."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    return {
        "formatString": {
            "type": "object",
            "returnType": "string",
            "properties": {
                call_key: {"const": "formatString"},
                "args": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                    },
                    "required": ["value"],
                },
            },
            "required": [call_key, "args"],
        }
    }


def design_system_catalog_dict(
    protocol_version: str = "1.0",
) -> dict[str, Any]:
    """Returns the raw `catalog.json` dictionary for the composable design-system catalog."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": DESIGN_SYSTEM_CATALOG_ID,
        "protocolVersion": protocol_version,
        "components": _design_system_components(),
        "functions": _standard_functions(protocol_version),
    }


def fixed_forms_catalog_dict(
    protocol_version: str = "1.0",
) -> dict[str, Any]:
    """Returns the raw `catalog.json` dictionary for the fixed-forms catalog."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": FIXED_FORMS_CATALOG_ID,
        "protocolVersion": protocol_version,
        "components": _fixed_forms_components(),
        "functions": _standard_functions(protocol_version),
    }


def hybrid_catalog_dict(protocol_version: str = "1.0") -> dict[str, Any]:
    """Returns a hybrid catalog combining composable primitives and `OrderEntryTicket`."""
    comps = _design_system_components()
    comps["OrderEntryTicket"] = _fixed_forms_components()["OrderEntryTicket"]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": HYBRID_CATALOG_ID,
        "protocolVersion": protocol_version,
        "components": comps,
        "functions": _standard_functions(protocol_version),
    }


def build_design_system_catalog(protocol_version: str = "1.0") -> Catalog:
    """Builds the composable design-system `Catalog`."""
    return Catalog.from_json(design_system_catalog_dict(protocol_version))


def build_fixed_forms_catalog(protocol_version: str = "1.0") -> Catalog:
    """Builds the monolithic fixed-forms `Catalog`."""
    return Catalog.from_json(fixed_forms_catalog_dict(protocol_version))


def build_hybrid_catalog(protocol_version: str = "1.0") -> Catalog:
    """Builds the hybrid `Catalog`."""
    return Catalog.from_json(hybrid_catalog_dict(protocol_version))


_ENTRY_FIELD_VARIANT: dict[str, Any] = {
    "component": "Entry",
    "label": {"$slot": "label"},
    "value": {"$slot": "value"},
}

DESIGN_SYSTEM_PATTERNS: dict[str, Any] = {
    "$schema": "https://a2ui.org/specification/v1_0/decision/pattern_definition.json",
    "catalogIds": [DESIGN_SYSTEM_CATALOG_ID],
    "version": "1",
    "patterns": {
        "page": {
            "slots": ["title", "subtitle", "mark", "blocks"],
            "knobs": {
                "dialog": ["yes", "no"],
                "stickyActions": ["yes", "no"],
            },
            "root": "page_stack",
            "components": [
                {
                    "id": "page_stack",
                    "component": "Stack",
                    "direction": "vertical",
                    "children": [
                        "page_title",
                        {"$if": "subtitle", "id": "page_subtitle"},
                        {"$blocks": True},
                    ],
                },
                {
                    "id": "page_title",
                    "component": "Label",
                    "text": {"$slot": "title"},
                },
                {
                    "id": "page_subtitle",
                    "component": "Label",
                    "text": {"$slot": "subtitle"},
                    "tone": "muted",
                },
            ],
        },
        "headline": {
            "slots": ["items"],
            "knobs": {
                "deltas": ["yes", "no"],
                "gauge": ["yes", "no"],
            },
            "root": "headline_stack",
            "components": [
                {
                    "id": "headline_stack",
                    "component": "Stack",
                    "direction": "horizontal",
                    "children": {
                        "$repeat": "items",
                        "component": "headline_stat",
                    },
                },
                {
                    "id": "headline_stat",
                    "component": "Stat",
                    "label": {"$slot": "label"},
                    "value": {"$slot": "value"},
                },
            ],
        },
        "facts": {
            "slots": ["rows"],
            "root": "facts_stack",
            "components": [
                {
                    "id": "facts_stack",
                    "component": "Stack",
                    "direction": "vertical",
                    "children": {
                        "$repeat": "rows",
                        "component": "facts_row",
                    },
                },
                {
                    "id": "facts_row",
                    "component": "Stack",
                    "direction": "horizontal",
                    "children": ["facts_label", "facts_value"],
                },
                {
                    "id": "facts_label",
                    "component": "Label",
                    "text": {"$slot": "label"},
                    "tone": "muted",
                },
                {
                    "id": "facts_value",
                    "component": "Label",
                    "text": {"$slot": "value"},
                },
            ],
        },
        "prose": {
            "slots": ["heading", "body"],
            "knobs": {
                "length": ["line", "blurb", "summary", "article"],
            },
            "root": "prose_stack",
            "components": [
                {
                    "id": "prose_stack",
                    "component": "Stack",
                    "direction": "vertical",
                    "children": [
                        {"$if": "heading", "id": "prose_heading"},
                        "prose_body",
                    ],
                },
                {
                    "id": "prose_heading",
                    "component": "Label",
                    "text": {"$slot": "heading"},
                },
                {
                    "id": "prose_body",
                    "component": "Label",
                    "text": {"$slot": "body"},
                },
            ],
        },
        "picture": {
            "slots": ["picture", "caption"],
            "knobs": {
                "framing": ["banner", "portrait", "object", "poster"],
                "prominence": ["mark", "supporting", "leading", "full"],
            },
            "root": "picture_fig",
            "components": [{
                "id": "picture_fig",
                "component": "Figure",
                "src": {"$slot": "picture"},
                "caption": {"$slot": "caption", "$default": ""},
            }],
        },
        "collection": {
            "slots": ["items"],
            "knobs": {
                "layout": ["rows"],
                "leading": ["none"],
                "trailing": ["none"],
            },
            "variants": [{
                "when": {"layout": "rows"},
                "root": "coll_stack",
                "components": [
                    {
                        "id": "coll_stack",
                        "component": "Stack",
                        "direction": "vertical",
                        "children": {
                            "$repeat": "items",
                            "component": "coll_item",
                        },
                    },
                    {
                        "id": "coll_item",
                        "component": "Stack",
                        "direction": "vertical",
                        "children": [
                            "coll_headline",
                            {"$if": "supporting", "id": "coll_supporting"},
                        ],
                    },
                    {
                        "id": "coll_headline",
                        "component": "Label",
                        "text": {"$slot": "headline"},
                    },
                    {
                        "id": "coll_supporting",
                        "component": "Label",
                        "text": {"$slot": "supporting"},
                        "tone": "muted",
                    },
                ],
            }],
        },
        "actions": {
            "slots": ["buttons"],
            "knobs": {
                "sticky": ["yes", "no"],
            },
            "root": "actions_stack",
            "components": [
                {
                    "id": "actions_stack",
                    "component": "Stack",
                    "direction": "horizontal",
                    "children": {
                        "$repeat": "buttons",
                        "component": "action_trigger",
                        "order": "primaryLast",
                    },
                },
                {
                    "id": "action_trigger",
                    "component": "Trigger",
                    "label": {"$slot": "label"},
                    "onPress": {"$event": "label"},
                },
            ],
        },
        "form": {
            "slots": ["fields"],
            "root": "form_stack",
            "components": [{
                "id": "form_stack",
                "component": "Stack",
                "direction": "vertical",
                "children": {
                    "$repeat": "fields",
                    "component": {"$byInstance": "control"},
                },
            }],
            "fieldVariants": {
                "shortText": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "longText": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "number": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "obscured": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "toggle": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "choice": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "multiChoice": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "range": copy.deepcopy(_ENTRY_FIELD_VARIANT),
                "date": copy.deepcopy(_ENTRY_FIELD_VARIANT),
            },
        },
    },
}


def build_broken_patterns() -> dict[str, Any]:
    """Returns a copy of `DESIGN_SYSTEM_PATTERNS` with one schema and one expand defect."""
    broken = copy.deepcopy(DESIGN_SYSTEM_PATTERNS)
    # 1. Schema defect: nonexistent component 'Gauge'
    broken["patterns"]["headline"]["components"][1]["component"] = "Gauge"
    # 2. Expand defect: root ID not in components list
    broken["patterns"]["actions"]["root"] = "nonexistent_root_id"
    return broken


BROKEN_PATTERNS: dict[str, Any] = build_broken_patterns()


FIXED_FORMS_TEMPLATES: dict[str, Any] = {
    "version": "1.0",
    "catalogId": FIXED_FORMS_CATALOG_ID,
    "protocolVersion": "1.0",
    "templates": {
        "order_entry_ticket": {
            "description": (
                "Mutable order entry ticket for placing equity buy or sell orders."
            ),
            "surfaceId": "order_entry_surface",
            "requiredPointers": ["/symbol", "/shares"],
            "isMutable": True,
            "components": [{
                "id": "root",
                "component": "OrderEntryTicket",
                "symbol": {"@path": "/symbol"},
                "shares": {"@path": "/shares"},
                "submitOrder": {
                    "event": {
                        "name": "submit_order",
                        "context": {
                            "symbol": {"@path": "/symbol"},
                            "shares": {"@path": "/shares"},
                        },
                    }
                },
            }],
        },
        "wire_transfer_form": {
            "description": "Wire transfer form for sending funds to a beneficiary.",
            "surfaceId": "wire_transfer_surface",
            "requiredPointers": ["/beneficiary", "/routingNumber", "/amount"],
            "isMutable": True,
            "components": [{
                "id": "root",
                "component": "WireTransferForm",
                "beneficiary": {"@path": "/beneficiary"},
                "routingNumber": {"@path": "/routingNumber"},
                "amount": {"@path": "/amount"},
                "sendWire": {
                    "event": {
                        "name": "send_wire",
                        "context": {
                            "beneficiary": {"@path": "/beneficiary"},
                            "amount": {"@path": "/amount"},
                        },
                    }
                },
            }],
        },
        "tax_withholding_form": {
            "description": (
                "Tax withholding election form for updating filing status and"
                " allowances."
            ),
            "surfaceId": "tax_withholding_surface",
            "requiredPointers": ["/filingStatus", "/allowances"],
            "isMutable": True,
            "components": [{
                "id": "root",
                "component": "TaxWithholdingForm",
                "filingStatus": {"@path": "/filingStatus"},
                "allowances": {"@path": "/allowances"},
                "saveElection": {
                    "event": {
                        "name": "save_election",
                        "context": {
                            "filingStatus": {"@path": "/filingStatus"},
                            "allowances": {"@path": "/allowances"},
                        },
                    }
                },
            }],
        },
    },
}


def build_broken_templates() -> dict[str, Any]:
    """Returns a copy of `FIXED_FORMS_TEMPLATES` with one schema and one payload defect."""
    broken = copy.deepcopy(FIXED_FORMS_TEMPLATES)
    # 1. Schema defect: nonexistent component 'UnknownTicket'
    broken["templates"]["order_entry_ticket"]["components"][0][
        "component"
    ] = "UnknownTicket"
    # 2. Payload defect: required pointer not present in FIXED_FORMS_SAMPLE_PAYLOADS
    broken["templates"]["tax_withholding_form"]["requiredPointers"] = [
        "/unmatchedPointer"
    ]
    return broken


BROKEN_TEMPLATES: dict[str, Any] = build_broken_templates()


DESIGN_SYSTEM_SAMPLE_PAYLOADS: dict[str, Any] = {
    "samples": {
        "browse_catalog": {
            "title": "Featured Products",
            "items": [
                {
                    "id": "p1",
                    "name": "Trail Runner",
                    "summary": "Lightweight mountain shoe",
                },
                {
                    "id": "p2",
                    "name": "Summit Pack",
                    "summary": "Weatherproof 35L backpack",
                },
                {
                    "id": "p3",
                    "name": "Alpine Tent",
                    "summary": "Four-season ultralight shelter",
                },
            ],
        },
        "monitor_metrics": {
            "serviceName": "Checkout API",
            "status": "HEALTHY",
            "latencyMs": 42,
            "errorRatePercent": 0.1,
            "summary": "All regions nominal.",
        },
    }
}


FIXED_FORMS_SAMPLE_PAYLOADS: dict[str, Any] = {
    "samples": {
        "order_ticket": {
            "symbol": "GOOG",
            "shares": 25,
        },
        "wire_transfer": {
            "beneficiary": "Acme Corp",
            "routingNumber": "021000021",
            "amount": 5000.0,
        },
        "tax_withholding": {
            "filingStatus": "Single",
            "allowances": 2,
        },
    }
}


def write_json(directory: Path, filename: str, data: Any) -> Path:
    """Writes `data` as JSON to `directory / filename` and returns the path."""
    target = directory / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return target
