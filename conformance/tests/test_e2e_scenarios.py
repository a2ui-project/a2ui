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

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import referencing
import yaml

from a2ui.core import Catalog
from a2ui.inference_formats import DirectJsonFormat, to_message_dicts
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart, ErrorPart, TextPart

CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONFORMANCE_DIR.parent

V10_COMMON_TYPES = json.loads(
    (REPO_ROOT / "specification" / "v1_0" / "json" / "common_types.json").read_text(
        encoding="utf-8"
    )
)
V10_AGENT_TO_RENDERER = json.loads(
    (
        REPO_ROOT / "specification" / "v1_0" / "json" / "agent_to_renderer.json"
    ).read_text(encoding="utf-8")
)
V10_RENDERER_TO_AGENT = json.loads(
    (
        REPO_ROOT / "specification" / "v1_0" / "json" / "renderer_to_agent.json"
    ).read_text(encoding="utf-8")
)
V10_CATALOG_STUB = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v1_0/catalog.json",
    "$defs": {
        "anyComponent": {"type": "object", "additionalProperties": True},
        "anyFunction": {"type": "object", "additionalProperties": True},
    },
}

V091_COMMON_TYPES = json.loads(
    (REPO_ROOT / "specification" / "v0_9_1" / "json" / "common_types.json").read_text(
        encoding="utf-8"
    )
)
V091_CATALOG_STUB = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/catalog.json",
    "$defs": {
        "anyComponent": {"type": "object", "additionalProperties": True},
        "anyFunction": {"type": "object", "additionalProperties": True},
    },
}
V091_SERVER_TO_CLIENT = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/server_to_client.json",
    **json.loads(
        (
            REPO_ROOT / "specification" / "v0_9_1" / "json" / "server_to_client.json"
        ).read_text(encoding="utf-8")
    ),
}
V091_CLIENT_TO_SERVER = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/client_to_server.json",
    **json.loads(
        (
            REPO_ROOT / "specification" / "v0_9_1" / "json" / "client_to_server.json"
        ).read_text(encoding="utf-8")
    ),
}

SPEC_REGISTRY = referencing.Registry().with_resources([
    (
        V10_COMMON_TYPES["$id"],
        referencing.Resource.from_contents(V10_COMMON_TYPES),
    ),
    (
        V10_AGENT_TO_RENDERER["$id"],
        referencing.Resource.from_contents(V10_AGENT_TO_RENDERER),
    ),
    (
        V10_RENDERER_TO_AGENT["$id"],
        referencing.Resource.from_contents(V10_RENDERER_TO_AGENT),
    ),
    (
        V10_CATALOG_STUB["$id"],
        referencing.Resource.from_contents(V10_CATALOG_STUB),
    ),
    (
        V091_COMMON_TYPES["$id"],
        referencing.Resource.from_contents(V091_COMMON_TYPES),
    ),
    (
        V091_SERVER_TO_CLIENT["$id"],
        referencing.Resource.from_contents(V091_SERVER_TO_CLIENT),
    ),
    (
        V091_CLIENT_TO_SERVER["$id"],
        referencing.Resource.from_contents(V091_CLIENT_TO_SERVER),
    ),
    (
        V091_CATALOG_STUB["$id"],
        referencing.Resource.from_contents(V091_CATALOG_STUB),
    ),
])

V10_AGENT_TO_RENDERER_VALIDATOR = jsonschema.Draft202012Validator(
    V10_AGENT_TO_RENDERER, registry=SPEC_REGISTRY
)
V10_RENDERER_TO_AGENT_VALIDATOR = jsonschema.Draft202012Validator(
    V10_RENDERER_TO_AGENT, registry=SPEC_REGISTRY
)
V091_SERVER_TO_CLIENT_VALIDATOR = jsonschema.Draft202012Validator(
    V091_SERVER_TO_CLIENT, registry=SPEC_REGISTRY
)
V091_CLIENT_TO_SERVER_VALIDATOR = jsonschema.Draft202012Validator(
    V091_CLIENT_TO_SERVER, registry=SPEC_REGISTRY
)

SAMPLE_PLACEHOLDERS = {
    "timestamp": "2026-01-01T00:00:00Z",
    "functionCallId": "call-1",
}


def substitute_match_any(value: Any, field_name: str = "") -> Any:
    if isinstance(value, dict):
        if value == {"$match": "any"}:
            return SAMPLE_PLACEHOLDERS.get(field_name, "sample")
        return {k: substitute_match_any(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute_match_any(item, field_name) for item in value]
    return value


def part_to_dict(part: Any) -> dict[str, Any]:
    if isinstance(part, TextPart):
        return {"text": part.text}
    if isinstance(part, A2uiPart):
        return {"a2ui": to_message_dicts(part.a2ui)}
    if isinstance(part, ErrorPart):
        return {"error": {"category": getattr(part.error, "category", "unknown")}}
    raise TypeError(f"Unexpected part type: {type(part)}")


def get_e2e_scenarios() -> list[tuple[str, dict[str, Any]]]:
    scenarios: list[tuple[str, dict[str, Any]]] = []
    e2e_dir = CONFORMANCE_DIR / "e2e"
    if not e2e_dir.exists():
        return scenarios
    for yaml_path in sorted(e2e_dir.rglob("*.yaml")):
        data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or []
        for case in data:
            if isinstance(case, dict) and case.get("action") == "e2e_scenario":
                scenarios.append((case["name"], case))
    return scenarios


def test_unique_scenario_names():
    scenarios = get_e2e_scenarios()
    assert scenarios, "No e2e scenarios found in conformance/e2e/**"
    names = [name for name, _ in scenarios]
    assert len(names) == len(set(names)), f"Duplicate scenario names found: {names}"


@pytest.mark.parametrize("name, scenario", get_e2e_scenarios())
def test_e2e_scenario_validation(name: str, scenario: dict[str, Any]):
    version = scenario["protocolVersion"]
    catalogs = []
    for cat_path in scenario["catalogPaths"]:
        full_path = REPO_ROOT / cat_path
        cat_data = json.loads(full_path.read_text(encoding="utf-8"))
        catalogs.append(Catalog.from_json(cat_data))

    # Track component IDs seen per surface
    surface_components: dict[str, set[str]] = {}

    for turn_idx, turn in enumerate(scenario["turns"]):
        # 1. Validate expectWire messages against agent_to_renderer / server_to_client schema
        for wire_part in turn.get("expectWire", []):
            if "a2ui" in wire_part:
                for msg in wire_part["a2ui"]:
                    if version == "1.0":
                        V10_AGENT_TO_RENDERER_VALIDATOR.validate(msg)
                    else:
                        norm = copy.deepcopy(msg)
                        if norm.get("version") == "v0.9.1":
                            norm["version"] = "v0.9"
                        V091_SERVER_TO_CLIENT_VALIDATOR.validate(norm)

                    # Collect component IDs
                    for key in ("createSurface", "updateComponents"):
                        if key in msg:
                            payload = msg[key]
                            surface_id = payload.get("surfaceId", "")
                            comps = payload.get("components", [])
                            comp_ids = {
                                c["id"]
                                for c in comps
                                if isinstance(c, dict) and "id" in c
                            }
                            surface_components.setdefault(surface_id, set()).update(
                                comp_ids
                            )

        # 2. Validate expectOutbound envelopes
        for env in turn.get("expectOutbound", []):
            subst = substitute_match_any(env)
            env_version = subst.get("version", version)
            if env_version == "1.0":
                V10_RENDERER_TO_AGENT_VALIDATOR.validate(subst)
            else:
                norm = copy.deepcopy(subst)
                if norm.get("version") == "v0.9.1":
                    norm["version"] = "v0.9"
                V091_CLIENT_TO_SERVER_VALIDATOR.validate(norm)

        # 3. Validate uiOps targets exist in that surface's components
        for op in turn.get("uiOps", []):
            surface_id = op["surfaceId"]
            target = op["targetNode"]
            known = surface_components.get(surface_id, set())
            assert target in known, (
                f"Turn {turn_idx}: uiOp targetNode '{target}' not found in surface"
                f" '{surface_id}' components: {known}"
            )

    # 4. Validate chunk presence for every declared format and verify parsing
    for fmt_name in scenario["formats"]:
        if fmt_name == "direct_json":
            parser = DirectJsonFormat(catalogs=catalogs).create_parser()
        elif fmt_name == "express":
            first_surface = next(iter(surface_components.keys()), "main")
            parser = ExpressFormat(
                catalogs=catalogs,
                surface_id=first_surface,
                version=version,
            ).create_parser()
        else:
            raise ValueError(f"Unsupported format in test: {fmt_name}")

        state = parser._empty_state()
        for turn_idx, turn in enumerate(scenario["turns"]):
            assert (
                fmt_name in turn["modelChunks"]
            ), f"Turn {turn_idx} missing chunks for format '{fmt_name}'"
            chunks = turn["modelChunks"][fmt_name]
            assert (
                isinstance(chunks, list) and chunks
            ), f"Turn {turn_idx} format '{fmt_name}' chunks must be a non-empty list"

            # Stream chunks through parser
            stream = parser.open_stream(state=state)
            parts = []
            for chunk in chunks:
                parts.extend(stream.feed(chunk))
            parts.extend(stream.close())

            # Convert parts and merge adjacent text parts
            actual_parts: list[dict[str, Any]] = []
            for p in parts:
                p_dict = part_to_dict(p)
                if "text" in p_dict and actual_parts and "text" in actual_parts[-1]:
                    actual_parts[-1]["text"] += p_dict["text"]
                else:
                    actual_parts.append(p_dict)

            expected_parts = turn["expectWire"]
            assert actual_parts == expected_parts, (
                f"Turn {turn_idx} format '{fmt_name}'"
                f" produced:\n{actual_parts}\nExpected:\n{expected_parts}"
            )
