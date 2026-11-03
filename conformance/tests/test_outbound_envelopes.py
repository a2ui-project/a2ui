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

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import referencing
import yaml


def _load_json_file(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_yaml_file(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONFORMANCE_DIR.parent

V10_COMMON_TYPES = _load_json_file(
    REPO_ROOT / "specification" / "v1_0" / "json" / "common_types.json"
)
V10_RENDERER_TO_AGENT = _load_json_file(
    REPO_ROOT / "specification" / "v1_0" / "json" / "renderer_to_agent.json"
)
V091_COMMON_TYPES = _load_json_file(
    REPO_ROOT / "specification" / "v0_9_1" / "json" / "common_types.json"
)
V091_CLIENT_TO_SERVER = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/client_to_server.json",
    **_load_json_file(
        REPO_ROOT / "specification" / "v0_9_1" / "json" / "client_to_server.json"
    ),
}

V10_CATALOG_STUB = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v1_0/catalog.json",
    "$defs": {"anyFunction": {"type": "object", "additionalProperties": True}},
}
V091_CATALOG_STUB = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/catalog.json",
    "$defs": {"anyFunction": {"type": "object", "additionalProperties": True}},
}

SPEC_REGISTRY = referencing.Registry().with_resources([
    (
        V10_COMMON_TYPES["$id"],
        referencing.Resource.from_contents(V10_COMMON_TYPES),
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
        V091_CLIENT_TO_SERVER["$id"],
        referencing.Resource.from_contents(V091_CLIENT_TO_SERVER),
    ),
    (
        V091_CATALOG_STUB["$id"],
        referencing.Resource.from_contents(V091_CATALOG_STUB),
    ),
])

V10_RENDERER_TO_AGENT_VALIDATOR = jsonschema.Draft202012Validator(
    V10_RENDERER_TO_AGENT, registry=SPEC_REGISTRY
)
V091_CLIENT_TO_SERVER_VALIDATOR = jsonschema.Draft202012Validator(
    V091_CLIENT_TO_SERVER, registry=SPEC_REGISTRY
)

SAMPLE_VALUES_BY_KEY: dict[str, str] = {
    "timestamp": "2026-01-01T00:00:00Z",
    "functionCallId": "call-1",
}


def substitute_match_any(value: Any, field_name: str = "") -> Any:
    """Replaces `{"$match": "any"}` wildcards with schema-valid sample values."""
    if isinstance(value, dict):
        if value == {"$match": "any"}:
            return SAMPLE_VALUES_BY_KEY.get(field_name, "sample")
        return {k: substitute_match_any(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute_match_any(item, field_name) for item in value]
    return value


def validate_outbound_envelope(envelope: dict[str, Any]) -> None:
    """Validates an expected outbound envelope against the protocol JSON schema."""
    substituted = substitute_match_any(envelope)
    version = substituted.get("version")
    if version == "1.0":
        V10_RENDERER_TO_AGENT_VALIDATOR.validate(substituted)
    elif version in ("v0.9", "v0.9.1"):
        normalized = (
            {**substituted, "version": "v0.9"} if version == "v0.9.1" else substituted
        )
        V091_CLIENT_TO_SERVER_VALIDATOR.validate(normalized)
    else:
        raise ValueError(f"Unsupported outbound envelope version: {version!r}")


def _adapter_yaml_files() -> list[Path]:
    files: list[Path] = []
    core_adapter = CONFORMANCE_DIR / "core" / "adapter_conformance.yaml"
    if core_adapter.exists():
        files.append(core_adapter)
    adapter_dir = CONFORMANCE_DIR / "adapter"
    if adapter_dir.exists():
        files.extend(sorted(adapter_dir.rglob("*.yaml")))
    return files


def _collect_outbound_envelopes() -> list[tuple[str, str, int, int, dict[str, Any]]]:
    collected: list[tuple[str, str, int, int, dict[str, Any]]] = []
    for yaml_path in _adapter_yaml_files():
        rel_path = yaml_path.relative_to(CONFORMANCE_DIR).as_posix()
        cases = _load_yaml_file(yaml_path) or []
        if not isinstance(cases, list):
            continue
        for case in cases:
            if not isinstance(case, dict):
                continue
            case_name = str(case.get("name", "<unnamed>"))
            for step_idx, step in enumerate(case.get("steps") or []):
                if not isinstance(step, dict) or "expectOutbound" not in step:
                    continue
                envelopes = step["expectOutbound"]
                assert isinstance(envelopes, list), (
                    f"{rel_path}::{case_name}[step {step_idx}] expectOutbound must be a"
                    " list"
                )
                for env_idx, envelope in enumerate(envelopes):
                    collected.append((rel_path, case_name, step_idx, env_idx, envelope))
    return collected


OUTBOUND_ENVELOPES = _collect_outbound_envelopes()


def test_adapter_conformance_has_expect_outbound_assertions() -> None:
    assert (
        OUTBOUND_ENVELOPES
    ), "Expected at least one expectOutbound envelope in adapter conformance YAML"


@pytest.mark.parametrize(
    ("rel_path", "case_name", "step_idx", "env_idx", "envelope"),
    OUTBOUND_ENVELOPES,
    ids=[f"{rel}::{case}[step{s}][{e}]" for rel, case, s, e, _ in OUTBOUND_ENVELOPES],
)
def test_outbound_envelopes_match_protocol_schema(
    rel_path: str,
    case_name: str,
    step_idx: int,
    env_idx: int,
    envelope: dict[str, Any],
) -> None:
    try:
        validate_outbound_envelope(envelope)
    except jsonschema.ValidationError as exc:
        pytest.fail(
            "Outbound envelope failed schema validation in "
            f"{rel_path}::{case_name} [step {step_idx}, envelope {env_idx}]:\n"
            f"  Message: {exc.message}\n"
            f"  Path: {list(exc.absolute_path)}"
        )


def test_substitute_match_any_and_rejection_of_invalid_envelopes() -> None:
    valid_rpc = {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": "main",
            "functionCallId": {"$match": "any"},
            "callFunction": {
                "@call": "fetchItems",
                "args": {"limit": 10},
            },
        },
    }
    validate_outbound_envelope(valid_rpc)

    invalid_action_missing_source = {
        "version": "1.0",
        "action": {
            "name": "buy_item",
            "surfaceId": "adapter_surface",
            "timestamp": {"$match": "any"},
            "context": {},
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        validate_outbound_envelope(invalid_action_missing_source)
