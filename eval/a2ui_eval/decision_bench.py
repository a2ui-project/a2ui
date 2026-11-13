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

"""Golden plan evaluation, Wave 6 metrics, and latency benchmark for decision models."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
import json
import math
from pathlib import Path
import re
import time
from typing import Any

from a2ui.inference_formats.decision import (
    ActionSpec,
    BackendCapabilities,
    Calibration,
    DecisionAnswer,
    DecisionBackend,
    DecisionBatch,
    DecisionQuestion,
    DecisionRecord,
    DecisionRenderTool,
    DecisionSynthesizer,
    PlanCache,
    QuestionKind,
    SurfaceOperation,
    SynthesisOutput,
    SynthesisStage,
    TemplateRegistry,
    inspect_payload_pointers,
)
from a2ui.parser import A2uiCompilationError
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import RendererState
import jsonschema
import yaml

from .decision_common import (
    FALSE_NO_FIT_TARGET,
    FORCED_FIT_TARGET,
    ParaphraseDecisionBackend,
    is_transcrypt_ciphertext,
)

_FORMAT_PTR_RE = re.compile(r"\$\{(/[^}]+)\}")


def _normalize_ptr(raw: str) -> str:
    """Normalizes a JSON Pointer string so non-empty paths begin with `/`."""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    return cleaned if cleaned.startswith("/") else f"/{cleaned}"


def _coerce_binding_pointers(val: Any) -> list[str]:
    """Converts a string or sequence of strings into normalized pointers."""
    if isinstance(val, str):
        return [_normalize_ptr(val)] if val.strip() else []
    if isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
        return [_normalize_ptr(str(v)) for v in val if str(v).strip()]
    return []


def _parse_expected_bindings(raw: Any) -> dict[str, list[str]]:
    """Normalizes `expected.bindings` into `slot_key -> [pointer, ...]`."""
    if not isinstance(raw, Mapping):
        return {}
    return {
        str(slot_key): ptrs
        for slot_key, val in raw.items()
        if (ptrs := _coerce_binding_pointers(val))
    }


def _parse_expected_actions(raw: Any) -> dict[str, list[str]]:
    """Normalizes `expected.actions` into `action_id -> [context_ptr_or_key, ...]`."""
    if not isinstance(raw, Mapping):
        return {}
    parsed: dict[str, list[str]] = {}
    for act_id, val in raw.items():
        if isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
            parsed[str(act_id)] = [str(v).strip() for v in val if str(v).strip()]
        else:
            parsed[str(act_id)] = []
    return parsed


@dataclass(frozen=True)
class PlanTurn:
    """Represents one turn in a multi-turn `PlanCase` sequence.

    Attributes:
        intent: Natural-language rendering intent for this turn.
        payload: Structured JSON payload for this turn.
        surface_id: Target A2UI surface identifier.
        actions: Declared action specifications keyed by action identifier.
        exclude: JSON Pointers excluded from planning for this turn.
        replace: Whether this turn forces a full surface replacement.
        region: Optional surface sub-region identifier to update.
        labels: Optional human-readable field label overrides.
        mutable_paths: JSON Pointers that accept two-way user input.
        layout: Optional explicit block layout hints for this turn.
        title: Optional explicit page title override for this turn.
        summary: Optional explicit page summary override for this turn.
        fallback_dsl: Optional A2UI Express fallback DSL for this turn.
        expected_operation: Expected surface operation (`create`, `update_root`,
            `update_region`, or `replace`).
        expected_cache_hit: Whether this turn is expected to hit the plan cache.
    """

    intent: str
    payload: dict[str, Any]
    surface_id: str = "main"
    actions: dict[str, Any] = field(default_factory=dict)
    exclude: list[str] = field(default_factory=list)
    replace: bool = False
    region: str | None = None
    labels: dict[str, str] = field(default_factory=dict)
    mutable_paths: list[str] = field(default_factory=list)
    layout: list[str] = field(default_factory=list)
    title: str | None = None
    summary: str | None = None
    fallback_dsl: str | None = None
    expected_operation: str | None = None
    expected_cache_hit: bool | None = None

    def action_specs(self) -> tuple[ActionSpec, ...]:
        """Parses `self.actions` map entries into `ActionSpec` instances."""
        return tuple(
            ActionSpec.from_block_value(str(act_id), val)
            for act_id, val in self.actions.items()
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PlanTurn:
        """Constructs a `PlanTurn` from a raw YAML turn mapping.

        Args:
            data: Raw dictionary parsed from a multi-turn case entry.

        Returns:
            A validated `PlanTurn` instance.
        """
        raw_labels = data.get("labels") or {}
        fb_dsl = data.get("fallback_dsl")
        if fb_dsl is None:
            fb_dsl = data.get("fallbackDsl")
        return cls(
            intent=str(data["intent"]),
            payload=dict(data.get("payload") or {}),
            surface_id=str(data.get("surface_id") or data.get("surfaceId") or "main"),
            actions=dict(data.get("actions") or {}),
            exclude=list(data.get("exclude") or []),
            replace=bool(data.get("replace", False)),
            region=str(data["region"]) if data.get("region") is not None else None,
            labels={str(k): str(v) for k, v in raw_labels.items()},
            mutable_paths=list(
                data.get("mutable_paths") or data.get("mutablePaths") or []
            ),
            layout=_seq_list(data.get("layout")),
            title=data.get("title"),
            summary=data.get("summary"),
            fallback_dsl=fb_dsl,
            expected_operation=(
                str(data["expected_operation"]).strip().lower()
                if data.get("expected_operation") is not None
                else None
            ),
            expected_cache_hit=(
                bool(data["expected_cache_hit"])
                if data.get("expected_cache_hit") is not None
                else None
            ),
        )


@dataclass(frozen=True)
class PlanCase:
    """Represents a single ground-truth decision evaluation case.

    Attributes:
        name: Unique case identifier within its split.
        intent: Natural-language rendering intent.
        payload: Structured JSON payload passed to the synthesizer.
        expected_family: Ground-truth job family (`none` for out-of-grammar cases).
        expected_archetypes: Acceptable ground-truth archetype identifiers.
        mode: Execution mode (`chat` or `tool`).
        tool_name: Optional tool name override when `mode == 'tool'`.
        actions: Declared action specifications keyed by action identifier.
        exclude: JSON Pointers excluded from planning.
        replace: Whether this case requests a full surface replacement.
        region: Optional surface sub-region identifier.
        labels: Optional human-readable field label overrides.
        mutable_paths: JSON Pointers that accept two-way user input.
        layout: Optional explicit block layout hints.
        title: Optional explicit page title override.
        summary: Optional explicit page summary override.
        fallback_dsl: Optional A2UI Express fallback DSL.
        sensitive: JSON Pointers that must never appear in rendered output.
        turns: Optional sequence of turns for multi-turn evaluation.
        required_blocks: Block identifiers that must appear in the layout plan.
        forbidden_blocks: Block identifiers that must not appear in the layout plan.
        expected_action_gate: Expected action-gate outcome (`pass`, `abstain`, or `any`).
        expected_bindings: Expected slot-to-pointer bindings (`<block>.<slot>`).
        expected_actions: Expected action identifiers and bound context keys/paths.
        split: Dataset split (`tuning` or `heldout`).
        tags: Case tags used for filtering.
        verified: Whether a human reviewer has verified the case labels.
        source: Optional provenance metadata dictionary.
    """

    name: str
    intent: str
    payload: dict[str, Any]
    expected_family: str
    expected_archetypes: list[str]
    mode: str = "chat"
    tool_name: str | None = None
    actions: dict[str, Any] = field(default_factory=dict)
    exclude: list[str] = field(default_factory=list)
    replace: bool = False
    region: str | None = None
    labels: dict[str, str] = field(default_factory=dict)
    mutable_paths: list[str] = field(default_factory=list)
    layout: list[str] = field(default_factory=list)
    title: str | None = None
    summary: str | None = None
    fallback_dsl: str | None = None
    sensitive: list[str] = field(default_factory=list)
    turns: list[PlanTurn] = field(default_factory=list)
    required_blocks: list[str] = field(default_factory=list)
    forbidden_blocks: list[str] = field(default_factory=list)
    expected_action_gate: str = "pass"
    expected_bindings: dict[str, list[str]] = field(default_factory=dict)
    expected_actions: dict[str, list[str]] = field(default_factory=dict)
    split: str | None = None
    tags: list[str] = field(default_factory=list)
    verified: bool = True
    source: dict[str, Any] | None = None

    @property
    def is_heldout(self) -> bool:
        """Returns whether this case belongs to the held-out evaluation split."""
        if self.split and self.split.strip().lower() == "heldout":
            return True
        lowered = {t.strip().lower() for t in self.tags}
        return "heldout" in lowered or "split:heldout" in lowered

    @property
    def is_out_of_grammar(self) -> bool:
        """Returns whether this case expects the planner to report `no_fit` (`none`)."""
        return self.expected_family.strip().lower() == "none"

    @property
    def effective_tool_name(self) -> str:
        """Returns the tool identifier used when `self.mode == 'tool'`."""
        return self.tool_name or f"render_{self.name}"

    def action_specs(self) -> tuple[ActionSpec, ...]:
        """Parses `self.actions` map entries into `ActionSpec` instances."""
        return tuple(
            ActionSpec.from_block_value(str(act_id), val)
            for act_id, val in self.actions.items()
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PlanCase:
        """Constructs a `PlanCase` from a raw YAML case mapping.

        Args:
            data: Raw dictionary parsed from a decision plan dataset YAML file.

        Returns:
            A validated `PlanCase` instance.
        """
        expected = dict(data.get("expected") or {})
        blocks = dict(expected.get("blocks") or {})
        raw_labels = dict(data.get("labels") or {})
        mode_val = _optional_trimmed_str(data.get("mode")) or "chat"
        gate_val = _optional_trimmed_str(expected.get("action_gate")) or "pass"
        fb_dsl = data.get("fallback_dsl")
        if fb_dsl is None:
            fb_dsl = data.get("fallbackDsl")
        return cls(
            name=str(data["name"]),
            intent=str(data["intent"]),
            payload=dict(data.get("payload") or {}),
            expected_family=_optional_trimmed_str(expected.get("family")) or "",
            expected_archetypes=_seq_list(expected.get("archetypes")),
            mode=mode_val.lower(),
            tool_name=_optional_trimmed_str(data.get("tool_name")),
            actions=dict(data.get("actions") or {}),
            exclude=_seq_list(data.get("exclude")),
            replace=bool(data.get("replace", False)),
            region=_optional_trimmed_str(data.get("region")),
            labels={str(k): str(v) for k, v in raw_labels.items()},
            mutable_paths=_seq_list(data.get("mutable_paths")),
            layout=_seq_list(data.get("layout")),
            title=data.get("title"),
            summary=data.get("summary"),
            fallback_dsl=fb_dsl,
            sensitive=_seq_list(data.get("sensitive")),
            turns=_parse_turns_list(data.get("turns")),
            required_blocks=_seq_list(blocks.get("required")),
            forbidden_blocks=_seq_list(blocks.get("forbidden")),
            expected_action_gate=gate_val,
            expected_bindings=_parse_expected_bindings(expected.get("bindings")),
            expected_actions=_parse_expected_actions(expected.get("actions")),
            split=_optional_trimmed_str(data.get("split")),
            tags=_seq_list(data.get("tags")),
            verified=bool(data.get("verified", True)),
            source=data.get("source"),
        )


def _optional_trimmed_str(value: Any) -> str | None:
    """Returns `str(value).strip()` when `value` is not None, else None."""
    return str(value).strip() if value is not None else None


def _seq_list(value: Any) -> list[Any]:
    """Returns `list(value)` when `value` is truthy, else an empty list."""
    return list(value) if value else []


def _parse_turns_list(raw_turns: Any) -> list[PlanTurn]:
    """Parses optional `turns` list entries into `PlanTurn` objects."""
    if not isinstance(raw_turns, Sequence) or isinstance(raw_turns, (str, bytes)):
        return []
    return [PlanTurn.from_dict(t) for t in raw_turns if isinstance(t, Mapping)]


def _parse_tag_filter(tags: Sequence[str] | str | None) -> set[str]:
    """Normalizes an optional tag filter string or sequence into a set."""
    if isinstance(tags, str):
        return {t.strip() for t in tags.split(",") if t.strip()}
    if tags:
        return {str(t).strip() for t in tags if str(t).strip()}
    return set()


def _matches_split(case: PlanCase, split: str | None) -> bool:
    """Checks whether `case` belongs to `split` (`tuning`, `heldout`, or `all`)."""
    if split is None:
        return True
    wanted = split.strip().lower()
    if not wanted or wanted == "all":
        return True
    if wanted == "heldout":
        return case.is_heldout
    if wanted == "tuning":
        return not case.is_heldout and (
            case.split is None or case.split.lower() == "tuning"
        )
    return (case.split or "").lower() == wanted


def _case_matches_filters(
    case: PlanCase,
    *,
    include_unverified: bool,
    target_tags: set[str],
    split: str | None,
) -> bool:
    """Checks whether `case` passes verification, tag, and split filters."""
    if not include_unverified and not case.verified:
        return False
    if target_tags and not any(t in target_tags for t in case.tags):
        return False
    return _matches_split(case, split)


def _load_single_yaml_file(
    path: Path, schema_path: str | Path | None
) -> list[PlanCase]:
    """Loads and validates `PlanCase` entries from one decrypted YAML file."""
    if is_transcrypt_ciphertext(path):
        raise RuntimeError(
            f"Decision cases file {path} is encrypted with Transcrypt; unlock"
            " datasets with `eval/bin/transcrypt` first."
        )
    schema_file = Path(schema_path) if schema_path else path.parent / "schema.json"
    schema = (
        json.loads(schema_file.read_text(encoding="utf-8"))
        if schema_file.is_file()
        else None
    )
    raw_cases = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    if schema is not None:
        jsonschema.validate(instance=raw_cases, schema=schema)
    return [PlanCase.from_dict(item) for item in raw_cases if isinstance(item, Mapping)]


def _resolve_directory_files(directory: Path, split: str | None) -> list[Path]:
    """Selects decrypted dataset YAML files inside `directory` for `split`."""
    wanted = (split or "all").strip().lower()
    candidates: list[Path] = []
    if wanted in {"tuning", "all", ""}:
        candidates.append(directory / "v1.yaml")
    if wanted in {"heldout", "all", ""}:
        candidates.append(directory / "heldout_v1.yaml")
    existing = [p for p in candidates if p.is_file()]
    decrypted = [p for p in existing if not is_transcrypt_ciphertext(p)]
    if existing and not decrypted:
        raise RuntimeError(
            f"Decision dataset files in {directory} are encrypted with"
            " Transcrypt; unlock datasets with `eval/bin/transcrypt` first."
        )
    return decrypted


def load_plan_cases(
    cases_path: str | Path,
    *,
    tags: Sequence[str] | str | None = None,
    split: str | None = None,
    include_unverified: bool = False,
    schema_path: str | Path | None = None,
) -> list[PlanCase]:
    """Loads and validates decision plan cases from a YAML file or dataset directory.

    Args:
        cases_path: Path to a YAML file or dataset directory containing `v1.yaml`
            and `heldout_v1.yaml`.
        tags: Optional comma-separated string or sequence of tags to keep.
        split: Optional split filter (`tuning`, `heldout`, or `all`).
        include_unverified: Whether to include cases marked `verified: false`.
        schema_path: Optional explicit JSON Schema file path.

    Returns:
        The list of `PlanCase` instances matching the requested filters.

    Raises:
        FileNotFoundError: If `cases_path` is a non-existent file path.
        RuntimeError: If the target dataset files are Transcrypt-encrypted.
    """
    path = Path(cases_path)
    if path.is_dir():
        files = _resolve_directory_files(path, split)
        parsed: list[PlanCase] = []
        for file_path in files:
            parsed.extend(_load_single_yaml_file(file_path, schema_path))
    else:
        if not path.is_file():
            raise FileNotFoundError(f"Decision cases file not found: {path}")
        parsed = _load_single_yaml_file(path, schema_path)

    target_tags = _parse_tag_filter(tags)
    return [
        case
        for case in parsed
        if _case_matches_filters(
            case,
            include_unverified=include_unverified,
            target_tags=target_tags,
            split=split,
        )
    ]


def is_action_gate_blocked(output: SynthesisOutput) -> bool:
    """Checks whether the synthesis run was blocked by an action gate.

    Args:
        output: Synthesis output returned by `DecisionSynthesizer`.

    Returns:
        True when synthesis abstained or fell back due to an action-gate check.
    """
    if output.stage is not SynthesisStage.ABSTAIN_FALLBACK:
        return False
    if output.fallback_reason == "action_gate" or "(action_gate)" in (
        output.fallback_reason or ""
    ):
        return True
    return any(
        record.question.id == "archetype_status" and record.outcome == "action_gate"
        for record in output.trace
    )


def is_no_fit_output(output: SynthesisOutput) -> bool:
    """Checks whether the planner reported `no_fit` (`family == 'none'`).

    Args:
        output: Synthesis output returned by `DecisionSynthesizer`.

    Returns:
        True when the planner selected `none` (`no_fit`).
    """
    reason = (output.fallback_reason or "").strip().lower()
    if reason == "no_fit" or "(no_fit)" in reason:
        return True
    return any(record.outcome == "no_fit" for record in output.trace)


@dataclass(frozen=True)
class CaseEvaluation:
    """Stores evaluation metrics for a single case execution.

    Attributes:
        output: Raw `SynthesisOutput` emitted by the synthesizer.
        wall_time_ms: Total end-to-end wall-clock execution time in milliseconds.
        family_correct: Whether the predicted family matched ground truth.
        archetype_correct: Whether the predicted archetype matched ground truth.
        block_precision: Precision over planned block identifiers.
        block_recall: Recall over required block identifiers.
        forbidden_block_count: Count of forbidden blocks present in the plan.
        action_gate_outcome: Observed action-gate outcome (`pass` or `abstain`).
        abstained: Whether synthesis abstained or fell back without a direct plan.
        used_fallback: Whether fallback messages were emitted.
        out_of_grammar: Whether the evaluated case expects `family == 'none'`.
        forced_fit: Whether an out-of-grammar case produced a forced layout plan.
        is_no_fit: Whether the planner reported `no_fit`.
        slot_binding_hits: Count of expected slot bindings satisfied.
        slot_binding_total: Total expected slot bindings declared on the case.
        has_sensitive: Whether the case declared sensitive JSON Pointers.
        sensitive_leaked: Whether any sensitive pointer or value leaked into output.
        action_hits: Count of expected action specifications satisfied.
        action_total: Total expected action specifications declared on the case.
        surface_calls: Number of decision backend round trips executed.
        surface_count: Number of surface turns evaluated in this run.
        turn_latencies_ms: Per-turn decision backend latencies in milliseconds.
        multi_turn_cache_hits: Count of multi-turn follow-up turns hitting cache.
        multi_turn_cache_opportunities: Count of multi-turn follow-up cache opportunities.
        multi_turn_op_hits: Count of multi-turn steps matching expected operation.
        multi_turn_op_total: Count of multi-turn steps declaring an expected operation.
    """

    output: SynthesisOutput
    wall_time_ms: float
    family_correct: bool
    archetype_correct: bool
    block_precision: float
    block_recall: float
    forbidden_block_count: int
    action_gate_outcome: str
    abstained: bool
    used_fallback: bool = False
    out_of_grammar: bool = False
    forced_fit: bool = False
    is_no_fit: bool = False
    slot_binding_hits: int = 0
    slot_binding_total: int = 0
    has_sensitive: bool = False
    sensitive_leaked: bool = False
    action_hits: int = 0
    action_total: int = 0
    surface_calls: int = 0
    surface_count: int = 1
    turn_latencies_ms: tuple[float, ...] = ()
    multi_turn_cache_hits: int = 0
    multi_turn_cache_opportunities: int = 0
    multi_turn_op_hits: int = 0
    multi_turn_op_total: int = 0

    @property
    def host_overhead_ms(self) -> float:
        """Returns host synthesis overhead in milliseconds (`wall_time - decision_latency`)."""
        return max(0.0, self.wall_time_ms - self.output.decision_latency_ms)


@dataclass
class CaseScore:
    """Aggregates evaluation metrics for a single case across repeat runs.

    Attributes:
        case: The ground-truth `PlanCase` evaluated.
        repeats: Number of repeat runs requested for this case.
        evaluations: Collected per-run `CaseEvaluation` instances.
    """

    case: PlanCase
    repeats: int
    evaluations: list[CaseEvaluation] = field(default_factory=list)

    @property
    def family_accuracy(self) -> float:
        """Returns the fraction of runs that predicted the expected job family."""
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.family_correct) / len(
            self.evaluations
        )

    @property
    def archetype_accuracy(self) -> float:
        """Returns the fraction of runs that predicted an expected archetype."""
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.archetype_correct) / len(
            self.evaluations
        )

    @property
    def block_precision(self) -> float:
        """Returns mean block precision across runs."""
        if not self.evaluations:
            return 0.0
        return sum(e.block_precision for e in self.evaluations) / len(self.evaluations)

    @property
    def block_recall(self) -> float:
        """Returns mean block recall across runs."""
        if not self.evaluations:
            return 0.0
        return sum(e.block_recall for e in self.evaluations) / len(self.evaluations)

    @property
    def abstain_rate(self) -> float:
        """Returns the fraction of runs that abstained or fell back."""
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.abstained) / len(self.evaluations)

    @property
    def fallback_rate(self) -> float:
        """Returns the fraction of runs that used a fallback path."""
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.used_fallback) / len(
            self.evaluations
        )

    @property
    def forced_fit_rate(self) -> float:
        """Returns the fraction of out-of-grammar runs that produced a forced plan."""
        if not self.evaluations or not self.case.is_out_of_grammar:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.forced_fit) / len(
            self.evaluations
        )

    @property
    def false_no_fit_rate(self) -> float:
        """Returns the fraction of in-grammar runs that erroneously reported `no_fit`."""
        if not self.evaluations or self.case.is_out_of_grammar:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.is_no_fit) / len(self.evaluations)

    @property
    def slot_binding_accuracy(self) -> float:
        """Returns micro-averaged slot binding recall across runs."""
        total = sum(e.slot_binding_total for e in self.evaluations)
        if total == 0:
            return 1.0
        return sum(e.slot_binding_hits for e in self.evaluations) / total

    @property
    def action_accuracy(self) -> float:
        """Returns micro-averaged action binding accuracy across runs."""
        total = sum(e.action_total for e in self.evaluations)
        if total == 0:
            return 1.0
        return sum(e.action_hits for e in self.evaluations) / total

    @property
    def sensitive_leak_rate(self) -> float:
        """Returns the fraction of sensitive-pointer runs that leaked sensitive data."""
        sens = [e for e in self.evaluations if e.has_sensitive]
        if not sens:
            return 0.0
        return sum(1.0 for e in sens if e.sensitive_leaked) / len(sens)

    @property
    def action_gate_match(self) -> bool:
        """Returns whether all runs matched `case.expected_action_gate`."""
        if not self.evaluations:
            return False
        expected = self.case.expected_action_gate
        if expected == "any":
            return True
        return all(e.action_gate_outcome == expected for e in self.evaluations)

    @property
    def decision_latency_p50(self) -> float:
        """Returns median decision backend latency in milliseconds across runs."""
        latencies = sorted(e.output.decision_latency_ms for e in self.evaluations)
        return _percentile(latencies, 0.50)

    @property
    def decision_latency_p95(self) -> float:
        """Returns 95th-percentile decision backend latency in milliseconds across runs."""
        latencies = sorted(e.output.decision_latency_ms for e in self.evaluations)
        return _percentile(latencies, 0.95)

    @property
    def host_overhead_p50(self) -> float:
        """Returns median host overhead in milliseconds across runs."""
        overheads = sorted(e.host_overhead_ms for e in self.evaluations)
        return _percentile(overheads, 0.50)

    @property
    def host_overhead_p95(self) -> float:
        """Returns 95th-percentile host overhead in milliseconds across runs."""
        overheads = sorted(e.host_overhead_ms for e in self.evaluations)
        return _percentile(overheads, 0.95)

    @property
    def round_trips_per_surface(self) -> float:
        """Returns mean decision backend round trips per evaluated surface turn."""
        surfaces = sum(e.surface_count for e in self.evaluations)
        if surfaces == 0:
            return 0.0
        return sum(e.surface_calls for e in self.evaluations) / surfaces

    @property
    def mean_decision_calls(self) -> float:
        """Returns an alias for `round_trips_per_surface`."""
        return self.round_trips_per_surface


def _percentile(sorted_values: list[float], q: float) -> float:
    """Computes linear-interpolated quantile `q` over pre-sorted `sorted_values`."""
    if not sorted_values:
        return 0.0
    idx = (len(sorted_values) - 1) * q
    low = int(math.floor(idx))
    high = int(math.ceil(idx))
    if low == high:
        return sorted_values[low]
    weight = idx - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def brier_score(pairs: Sequence[tuple[float, float]]) -> float:
    """Computes the mean squared error (Brier score) for probability pairs.

    Args:
        pairs: Sequence of `(predicted_probability, binary_label)` pairs.

    Returns:
        The mean squared calibration error in `[0.0, 1.0]`.
    """
    if not pairs:
        return 0.0
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def _bin_bounds_match(p: float, low: float, high: float, is_last: bool) -> bool:
    """Returns whether probability `p` falls inside `[low, high)` (or `[low, high]`)."""
    if is_last:
        return low <= p <= high or math.isclose(p, high)
    return low <= p < high


def expected_calibration_error(
    pairs: Sequence[tuple[float, float]], num_bins: int = 10
) -> float:
    """Computes Expected Calibration Error (ECE) across `num_bins` equal bins.

    Args:
        pairs: Sequence of `(predicted_probability, binary_label)` pairs.
        num_bins: Number of equal-width probability bins across `[0.0, 1.0]`.

    Returns:
        The weighted average absolute difference between bin confidence and accuracy.
    """
    if not pairs or num_bins <= 0:
        return 0.0
    bin_size = 1.0 / num_bins
    total = len(pairs)
    ece = 0.0
    for b in range(num_bins):
        low = b * bin_size
        high = (b + 1) * bin_size
        in_bin = [
            (p, y)
            for p, y in pairs
            if _bin_bounds_match(p, low, high, b == num_bins - 1)
        ]
        if not in_bin:
            continue
        bin_count = len(in_bin)
        avg_conf = sum(p for p, _ in in_bin) / bin_count
        avg_acc = sum(y for _, y in in_bin) / bin_count
        ece += (bin_count / total) * abs(avg_acc - avg_conf)
    return ece


TEMPERATURE_GRID = (
    0.25,
    0.50,
    0.75,
    1.00,
    1.25,
    1.50,
    1.75,
    2.00,
    2.25,
    2.50,
    2.75,
    3.00,
    3.25,
    3.50,
    3.75,
    4.00,
)


def _rescale_binary_probability(p: float, cal: Calibration) -> float:
    """Applies `Calibration` temperature scaling to a binary probability `p`."""
    p_clamped = min(max(p, 1e-6), 1.0 - 1e-6)
    scaled = cal.apply({"pos": p_clamped, "neg": 1.0 - p_clamped})
    return scaled["pos"]


def fit_temperature(
    calibration_data: Sequence[tuple[float, float]],
    candidates: Sequence[float] | None = None,
) -> float:
    """Finds temperature `T` in `candidates` that minimizes Expected Calibration Error.

    Args:
        calibration_data: Sequence of `(predicted_probability, binary_label)` pairs.
        candidates: Optional candidate temperature grid; defaults to `TEMPERATURE_GRID`.

    Returns:
        The positive temperature value minimizing ECE (ties prefer `1.0`).
    """
    if not calibration_data:
        return 1.0
    grid = candidates or TEMPERATURE_GRID
    best_temp = 1.0
    best_ece = float("inf")

    for temp in grid:
        if temp <= 0:
            continue
        cal = Calibration(temperature=float(temp))
        rescaled = [
            (_rescale_binary_probability(p, cal), y) for p, y in calibration_data
        ]
        ece = expected_calibration_error(rescaled)
        if ece < best_ece or (math.isclose(ece, best_ece) and temp == 1.0):
            best_ece = ece
            best_temp = float(temp)

    return best_temp


@dataclass
class BenchmarkSummary:
    """Stores the complete Wave 6 summary of a golden plan benchmark run.

    Attributes:
        cases_count: Number of distinct `PlanCase` entries evaluated.
        total_runs: Total case executions (`cases_count * repeat`).
        backend_kind: Decision backend kind identifier.
        model_id: Underlying model identifier.
        family_accuracy: In-grammar job family classification accuracy.
        archetype_accuracy: In-grammar archetype classification accuracy.
        block_precision: Mean block precision across all runs.
        block_recall: Mean block recall across all runs.
        abstain_rate: Fraction of runs that abstained or fell back.
        fallback_rate: Fraction of runs that emitted fallback output.
        round_trips_per_surface: Mean decision backend calls per surface turn.
        decision_latency_p50: Median per-turn decision backend latency in milliseconds.
        decision_latency_p95: 95th-percentile per-turn decision backend latency in ms.
        host_overhead_p50: Median host synthesis overhead in milliseconds.
        host_overhead_p95: 95th-percentile host synthesis overhead in milliseconds.
        decision_calls_mean: Alias for `round_trips_per_surface`.
        brier_family: Brier calibration score for family questions.
        ece_family: Expected Calibration Error for family questions.
        brier_archetype: Brier calibration score for in-grammar archetype questions.
        ece_archetype: Expected Calibration Error for in-grammar archetype questions.
        brier_gates: Brier calibration score for optional block gate questions.
        ece_gates: Expected Calibration Error for optional block gate questions.
        forced_fit_rate: Fraction of out-of-grammar runs that produced a forced plan.
        false_no_fit_rate: Fraction of in-grammar runs that reported `no_fit`.
        slot_binding_accuracy: Micro-averaged slot binding recall across runs.
        sensitive_leak_rate: Fraction of sensitive-pointer runs that leaked data.
        action_accuracy: Micro-averaged action binding accuracy across runs.
        multi_turn_cache_hit_rate: Plan cache hit rate on multi-turn follow-up turns.
        multi_turn_operation_accuracy: Surface operation accuracy on multi-turn steps.
        in_grammar_count: Number of evaluated in-grammar cases.
        out_of_grammar_count: Number of evaluated out-of-grammar (`none`) cases.
        unverified_count: Number of evaluated cases with `verified: false`.
        split_name: Name of the evaluated dataset split.
        fitted_temperature: Optional temperature fitted over collected calibration pairs.
        case_scores: Per-case aggregated `CaseScore` results.
    """

    cases_count: int
    total_runs: int
    backend_kind: str
    model_id: str
    family_accuracy: float
    archetype_accuracy: float
    block_precision: float
    block_recall: float
    abstain_rate: float
    fallback_rate: float
    round_trips_per_surface: float
    decision_latency_p50: float
    decision_latency_p95: float
    host_overhead_p50: float
    host_overhead_p95: float
    decision_calls_mean: float
    brier_family: float
    ece_family: float
    brier_archetype: float
    ece_archetype: float
    brier_gates: float
    ece_gates: float
    forced_fit_rate: float = 0.0
    false_no_fit_rate: float = 0.0
    slot_binding_accuracy: float = 1.0
    sensitive_leak_rate: float = 0.0
    action_accuracy: float = 1.0
    multi_turn_cache_hit_rate: float = 0.0
    multi_turn_operation_accuracy: float = 1.0
    in_grammar_count: int = 0
    out_of_grammar_count: int = 0
    unverified_count: int = 0
    split_name: str = "all"
    fitted_temperature: float | None = None
    case_scores: list[CaseScore] = field(default_factory=list)

    @property
    def mean_round_trips(self) -> float:
        """Returns mean decision backend round trips per surface turn."""
        return self.round_trips_per_surface

    @property
    def p50_latency_ms(self) -> float:
        """Returns median decision backend latency in milliseconds."""
        return self.decision_latency_p50

    @property
    def p95_latency_ms(self) -> float:
        """Returns 95th-percentile decision backend latency in milliseconds."""
        return self.decision_latency_p95


@dataclass(frozen=True)
class ParaphraseComparison:
    """Stores accuracy deltas when question prompts are rewritten via `PARAPHRASE_PROMPT_TABLE`.

    Attributes:
        baseline: Benchmark summary with default decision question prompts.
        paraphrased: Benchmark summary with paraphrased decision question prompts.
    """

    baseline: BenchmarkSummary
    paraphrased: BenchmarkSummary

    @property
    def family_accuracy_delta(self) -> float:
        """Returns `paraphrased.family_accuracy - baseline.family_accuracy`."""
        return self.paraphrased.family_accuracy - self.baseline.family_accuracy

    @property
    def archetype_accuracy_delta(self) -> float:
        """Returns `paraphrased.archetype_accuracy - baseline.archetype_accuracy`."""
        return self.paraphrased.archetype_accuracy - self.baseline.archetype_accuracy

    @property
    def slot_binding_accuracy_delta(self) -> float:
        """Returns `paraphrased.slot_binding_accuracy - baseline.slot_binding_accuracy`."""
        return (
            self.paraphrased.slot_binding_accuracy - self.baseline.slot_binding_accuracy
        )

    @property
    def forced_fit_rate_delta(self) -> float:
        """Returns `paraphrased.forced_fit_rate - baseline.forced_fit_rate`."""
        return self.paraphrased.forced_fit_rate - self.baseline.forced_fit_rate

    @property
    def false_no_fit_rate_delta(self) -> float:
        """Returns `paraphrased.false_no_fit_rate - baseline.false_no_fit_rate`."""
        return self.paraphrased.false_no_fit_rate - self.baseline.false_no_fit_rate


@dataclass(frozen=True)
class TemplateArmComparison:
    """Compares unpromoted planner arm against promoted `SurfaceTemplate` arm on tool cases.

    Attributes:
        tool_cases_count: Number of in-grammar `mode == 'tool'` cases evaluated.
        planner_arm: Benchmark summary for unpromoted `DecisionRenderTool` planning.
        template_arm: Benchmark summary after promoting a seed run to `SurfaceTemplate`.
    """

    tool_cases_count: int
    planner_arm: BenchmarkSummary
    template_arm: BenchmarkSummary


def _resolve_pointer_in_payload(payload: Mapping[str, Any], pointer: str) -> Any:
    """Resolves an RFC 6901 JSON Pointer in `payload`, or returns None."""
    norm = _normalize_ptr(pointer)
    if not norm or not payload:
        return None
    cur: Any = payload
    for raw_seg in norm.lstrip("/").split("/"):
        seg = raw_seg.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, Mapping) and seg in cur:
            cur = cur[seg]
        elif (
            isinstance(cur, Sequence)
            and not isinstance(cur, (str, bytes))
            and seg.isdigit()
            and int(seg) < len(cur)
        ):
            cur = cur[int(seg)]
        else:
            return None
    return cur


def _extract_rendered_components(output: SynthesisOutput) -> list[dict[str, Any]]:
    """Collects component dicts from `createSurface` and `updateComponents` envelopes."""
    components: list[dict[str, Any]] = []
    for msg in to_message_dicts(output.messages):
        for env_key in ("createSurface", "updateComponents"):
            env = msg.get(env_key)
            if isinstance(env, Mapping) and isinstance(env.get("components"), list):
                components.extend(
                    dict(c) for c in env["components"] if isinstance(c, Mapping)
                )
    return components


def _collect_component_paths(value: Any, found: set[str]) -> None:
    """Recursively extracts bound JSON Pointers (`@path`, `path`, `${/...}`) from `value`."""
    if isinstance(value, str):
        for match in _FORMAT_PTR_RE.findall(value):
            found.add(match)
        return
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for elem in value:
            _collect_component_paths(elem, found)
        return
    if not isinstance(value, Mapping):
        return
    for key in ("@path", "path"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            found.add(raw.strip())
    for child in value.values():
        _collect_component_paths(child, found)


def _component_matches_block(comp_id: str, block_id: str) -> bool:
    """Returns whether `comp_id` belongs to `block_id` (`<block>_*` or `<slug>_<block>_*`)."""
    if block_id == "page":
        return comp_id == "root" or comp_id.startswith("page_")
    return comp_id.startswith(f"{block_id}_") or f"_{block_id}_" in comp_id


_EQUIVALENT_SLOT_ALIASES: dict[tuple[str, str], tuple[str, str]] = {
    ("collection", "items"): ("comparison", "options"),
    ("comparison", "options"): ("collection", "items"),
}


def _block_slot_pointers(
    blocks: Sequence[Any], block_id: str, slot_name: str
) -> set[str] | None:
    """Returns bound pointers for `block_id.slot_name` in `blocks`, or None if `block_id` is absent."""
    blk = next((b for b in blocks if b.block_id == block_id), None)
    if blk is None:
        return None
    sb = blk.bindings.get(slot_name)
    return set(sb.pointers()) if sb is not None else set()


def _plan_slot_pointers(plan: Any, block_id: str, slot_name: str) -> set[str] | None:
    """Extracts pointers for `block_id.slot_name` from a planned `LayoutPlan`."""
    if plan is None:
        return None
    if block_id == "page":
        page_slot = getattr(plan.page, slot_name, None)
        ptrs = set(page_slot.pointers()) if page_slot is not None else set()
        return ptrs or None
    if not plan.blocks:
        return None
    direct = _block_slot_pointers(plan.blocks, block_id, slot_name)
    if direct is not None:
        return direct
    alias = _EQUIVALENT_SLOT_ALIASES.get((block_id, slot_name))
    if alias is not None:
        aliased = _block_slot_pointers(plan.blocks, alias[0], alias[1])
        if aliased is not None:
            return aliased
    return set()


def _template_block_pointers(
    block_id: str, components: Sequence[Mapping[str, Any]]
) -> set[str]:
    """Extracts bound data pointers from template components matching `block_id`."""
    found: set[str] = set()
    for comp in components:
        if _component_matches_block(str(comp.get("id", "")), block_id):
            _collect_component_paths(comp, found)
    return found


def _claimed_pointers_for_slot(
    slot_key: str,
    output: SynthesisOutput,
    components: Sequence[Mapping[str, Any]],
) -> set[str]:
    """Extracts JSON Pointers claimed by `slot_key` (`<block>.<slot>` or `page.<slot>`)."""
    block_id, _, slot_name = slot_key.partition(".")
    if not block_id or not slot_name:
        return set()
    from_plan = _plan_slot_pointers(output.layout_plan, block_id, slot_name)
    if from_plan is not None:
        return from_plan
    is_tpl = output.selected_template_id is not None or (
        output.layout_plan is not None and output.layout_plan.template_id is not None
    )
    return _template_block_pointers(block_id, components) if is_tpl else set()


def _pointer_matches_claimed(expected_ptr: str, claimed: set[str]) -> bool:
    """Checks whether `expected_ptr` equals or shares a parent/element path in `claimed`."""
    return any(
        expected_ptr == cp
        or expected_ptr.startswith(f"{cp}/")
        or cp.startswith(f"{expected_ptr}/")
        for cp in claimed
    )


def _score_slot_bindings(
    case: PlanCase,
    output: SynthesisOutput,
    components: Sequence[Mapping[str, Any]],
) -> tuple[int, int]:
    """Returns `(hits, total)` across `case.expected_bindings`."""
    if not case.expected_bindings:
        return 0, 0
    hits = 0
    for slot_key, acceptable in case.expected_bindings.items():
        claimed = _claimed_pointers_for_slot(slot_key, output, components)
        if any(_pointer_matches_claimed(exp_p, claimed) for exp_p in acceptable):
            hits += 1
    return hits, len(case.expected_bindings)


def _single_pointer_leaked(
    sens_ptr: str,
    payloads: Sequence[Mapping[str, Any]],
    comp_paths: set[str],
    serialized_components: str,
) -> bool:
    """Checks whether `sens_ptr` leaked via component binding path or literal string value."""
    norm = _normalize_ptr(sens_ptr)
    if not norm:
        return False
    if any(bp == norm or bp.startswith(f"{norm}/") for bp in comp_paths):
        return True
    for data in payloads:
        raw_val = _resolve_pointer_in_payload(data, norm)
        if (
            isinstance(raw_val, str)
            and len(raw_val.strip()) >= 4
            and raw_val in serialized_components
        ):
            return True
    return False


def _has_sensitive_leak(
    sensitive_ptrs: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
    components: Sequence[Mapping[str, Any]],
) -> bool:
    """Checks whether any pointer in `sensitive_ptrs` leaked into `components`."""
    if not sensitive_ptrs or not components:
        return False
    comp_paths: set[str] = set()
    _collect_component_paths(components, comp_paths)
    serialized = json.dumps(list(components))
    return any(
        _single_pointer_leaked(ptr, payloads, comp_paths, serialized)
        for ptr in sensitive_ptrs
    )


def _collect_event_dicts(value: Any, found: list[Mapping[str, Any]]) -> None:
    """Recursively collects A2UI `event` objects (`{"name": ...}`) from components."""
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for item in value:
            _collect_event_dicts(item, found)
        return
    if not isinstance(value, Mapping):
        return
    ev = value.get("event")
    if isinstance(ev, Mapping) and isinstance(ev.get("name"), str):
        found.append(ev)
    for child in value.values():
        _collect_event_dicts(child, found)


def _event_bound_tokens(event_obj: Mapping[str, Any]) -> set[str]:
    """Extracts bound context paths and keys from an `event` dict."""
    ctx = event_obj.get("context")
    if not isinstance(ctx, Mapping):
        return set()
    tokens: set[str] = set(str(k) for k in ctx.keys())
    paths: set[str] = set()
    _collect_component_paths(ctx, paths)
    tokens.update(paths)
    tokens.update(p.lstrip("/") for p in paths)
    return tokens


def _event_matches_expected_context(
    event_obj: Mapping[str, Any],
    expected_ctx: Sequence[str],
    *,
    has_mutable: bool,
    send_data_model: bool,
) -> bool:
    """Checks whether `event_obj` satisfies `expected_ctx` (or `sendDataModel` on submit)."""
    tokens = _event_bound_tokens(event_obj)
    if expected_ctx:
        return all(
            req in tokens or req.lstrip("/") in tokens or _normalize_ptr(req) in tokens
            for req in expected_ctx
        )
    if has_mutable:
        return bool(tokens) or send_data_model
    return True


def _score_expected_actions(
    case: PlanCase,
    output: SynthesisOutput,
    components: Sequence[Mapping[str, Any]],
) -> tuple[int, int]:
    """Returns `(hits, total)` across `case.expected_actions`."""
    if not case.expected_actions:
        return 0, 0
    events: list[Mapping[str, Any]] = []
    _collect_event_dicts(components, events)
    send_dm = any(
        isinstance(d.get("createSurface"), Mapping)
        and bool(d["createSurface"].get("sendDataModel"))
        for d in to_message_dicts(output.messages)
    )
    has_mut = bool(case.mutable_paths)
    hits = 0
    for act_id, req_ctx in case.expected_actions.items():
        matching = [ev for ev in events if ev.get("name") == act_id]
        if any(
            _event_matches_expected_context(
                ev, req_ctx, has_mutable=has_mut, send_data_model=send_dm
            )
            for ev in matching
        ):
            hits += 1
    return hits, len(case.expected_actions)


def _observed_family_and_prob(
    answers_by_id: Mapping[str, DecisionAnswer], output: SynthesisOutput
) -> tuple[str, float]:
    """Extracts `(observed_family, probability)` from `output` and `answers_by_id`."""
    if is_no_fit_output(output):
        fam_ans = answers_by_id.get("family")
        prob = (
            fam_ans.distribution.probabilities.get("none", fam_ans.top()[1])
            if fam_ans is not None
            else 1.0
        )
        return "none", prob
    if output.layout_plan is not None and output.layout_plan.family:
        fam = output.layout_plan.family
        fam_ans = answers_by_id.get("family")
        prob = (
            fam_ans.distribution.probabilities.get(fam, fam_ans.top()[1])
            if fam_ans is not None
            else 1.0
        )
        return fam, prob
    if "family" in answers_by_id:
        return answers_by_id["family"].top()
    return "", 1.0


def _observed_archetype_and_prob(
    answers_by_id: Mapping[str, DecisionAnswer],
    output: SynthesisOutput,
    observed_family: str,
) -> tuple[str, float]:
    """Extracts `(observed_archetype, probability)` from `layout_plan` or answers."""
    if output.layout_plan is not None and output.layout_plan.archetype:
        arch_ans = answers_by_id.get(f"archetype:{output.layout_plan.family}")
        prob = arch_ans.top()[1] if arch_ans is not None else output.confidence
        return output.layout_plan.archetype, prob
    fam_arch_id = f"archetype:{observed_family}"
    if fam_arch_id in answers_by_id:
        return answers_by_id[fam_arch_id].top()
    for qid, ans in answers_by_id.items():
        if qid.startswith("archetype:"):
            return ans.top()
    return "", 1.0


def _block_precision_and_recall(
    case: PlanCase, output: SynthesisOutput
) -> tuple[float, float, int]:
    """Computes `(precision, recall, forbidden_count)` for planned blocks."""
    observed = (
        {b.block_id for b in output.layout_plan.blocks}
        if output.layout_plan is not None
        else set()
    )
    required_set = set(case.required_blocks)
    if (
        "compare" in case.expected_archetypes
        and "comparison" in observed
        and "collection" in required_set
    ):
        required_set = (required_set - {"collection"}) | {"comparison"}
    forbidden_set = set(case.forbidden_blocks)
    if required_set:
        recall = len(required_set & observed) / len(required_set)
        precision = len(required_set & observed) / len(observed) if observed else 0.0
    else:
        recall = 1.0
        precision = 1.0
    forbidden_count = len(forbidden_set & observed)
    if forbidden_count > 0:
        precision = max(0.0, precision - (forbidden_count * 0.25))
    return precision, recall, forbidden_count


def _build_calibration_points(
    case: PlanCase,
    answers_by_id: Mapping[str, DecisionAnswer],
    family_prob: float,
    family_correct: bool,
    archetype_prob: float,
    archetype_correct: bool,
) -> list[tuple[str, float, float]]:
    """Extracts `(kind, probability, label)` calibration points for `case`."""
    cal_points: list[tuple[str, float, float]] = [
        ("family", family_prob, 1.0 if family_correct else 0.0),
    ]
    if not case.is_out_of_grammar:
        cal_points.append(
            ("archetype", archetype_prob, 1.0 if archetype_correct else 0.0)
        )
    required_set = set(case.required_blocks)
    forbidden_set = set(case.forbidden_blocks)
    for qid, ans in answers_by_id.items():
        if qid.startswith("gate:"):
            block_id = qid.removeprefix("gate:")
            if block_id in required_set:
                cal_points.append(("gate", ans.yes, 1.0))
            elif block_id in forbidden_set:
                cal_points.append(("gate", ans.yes, 0.0))
    return cal_points


def evaluate_single_run(
    case: PlanCase, output: SynthesisOutput, wall_time_ms: float
) -> tuple[CaseEvaluation, list[tuple[str, float, float]]]:
    """Evaluates one synthesis output against `case` expectations.

    Args:
        case: Ground-truth `PlanCase` entry.
        output: `SynthesisOutput` produced by `DecisionSynthesizer`.
        wall_time_ms: End-to-end wall-clock execution duration in milliseconds.

    Returns:
        A `(case_evaluation, calibration_points)` tuple for the run.
    """
    answers_by_id = {ans.question_id: ans for ans in output.decision_answers}
    no_fit = is_no_fit_output(output)
    # Out-of-grammar cases only count as forced-fit when the planner built a
    # direct layout plan instead of abstaining or using fallback messages.
    forced_fit = (
        case.is_out_of_grammar
        and output.layout_plan is not None
        and output.fallback_source is None
        and output.stage is not SynthesisStage.ABSTAIN_FALLBACK
    )
    observed_family, family_prob = _observed_family_and_prob(answers_by_id, output)
    observed_archetype, archetype_prob = _observed_archetype_and_prob(
        answers_by_id, output, observed_family
    )

    if case.is_out_of_grammar:
        family_correct = not forced_fit
        archetype_correct = not forced_fit
    else:
        family_correct = (
            not no_fit and observed_family.lower() == case.expected_family.lower()
        )
        archetype_correct = not no_fit and observed_archetype.lower() in {
            a.lower() for a in case.expected_archetypes
        }

    precision, recall, forbidden_count = _block_precision_and_recall(case, output)
    is_blocked = is_action_gate_blocked(output)
    action_gate_outcome = "abstain" if is_blocked else "pass"
    used_fallback = output.fallback_source is not None
    abstained = output.stage is SynthesisStage.ABSTAIN_FALLBACK or not output.messages

    components = _extract_rendered_components(output)
    slot_hits, slot_total = _score_slot_bindings(case, output, components)
    act_hits, act_total = _score_expected_actions(case, output, components)
    sens_leaked = _has_sensitive_leak(case.sensitive, (case.payload,), components)

    eval_result = CaseEvaluation(
        output=output,
        wall_time_ms=wall_time_ms,
        family_correct=family_correct,
        archetype_correct=archetype_correct,
        block_precision=precision,
        block_recall=recall,
        forbidden_block_count=forbidden_count,
        action_gate_outcome=action_gate_outcome,
        abstained=abstained,
        used_fallback=used_fallback,
        out_of_grammar=case.is_out_of_grammar,
        forced_fit=forced_fit,
        is_no_fit=no_fit,
        slot_binding_hits=slot_hits,
        slot_binding_total=slot_total,
        has_sensitive=bool(case.sensitive),
        sensitive_leaked=sens_leaked,
        action_hits=act_hits,
        action_total=act_total,
        surface_calls=output.decision_calls,
        surface_count=1,
        turn_latencies_ms=(output.decision_latency_ms,),
    )
    cal_points = _build_calibration_points(
        case,
        answers_by_id,
        family_prob,
        family_correct,
        archetype_prob,
        archetype_correct,
    )
    return eval_result, cal_points


class _BackendCallRecorder(DecisionBackend):
    """Wraps a `DecisionBackend` to retain answers and timings across abstentions.

    Attributes:
        answers: Ordered `DecisionAnswer` entries collected across calls.
        calls: Total `answer` round trips recorded.
        latency_ms: Cumulative backend execution latency in milliseconds.
    """

    def __init__(self, inner: DecisionBackend) -> None:
        """Initializes the recorder around `inner`."""
        self._inner = inner
        self.answers: list[DecisionAnswer] = []
        self.calls: int = 0
        self.latency_ms: float = 0.0

    @property
    def backend_kind(self) -> str:
        """Returns the wrapped backend kind."""
        return self._inner.backend_kind

    @property
    def model_id(self) -> str:
        """Returns the wrapped model identifier."""
        return self._inner.model_id

    @property
    def capabilities(self) -> BackendCapabilities:
        """Returns the wrapped backend capabilities."""
        return self._inner.capabilities

    @property
    def last_call_latency_ms(self) -> float | None:
        """Returns the latency of the most recent inner backend call in ms."""
        val = getattr(self._inner, "last_call_latency_ms", None)
        return float(val) if isinstance(val, (int, float)) else None

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Delegates `batch` to the inner backend while recording answers and latency."""
        t0 = time.perf_counter()
        result = await self._inner.answer(batch)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        reported = self.last_call_latency_ms
        if reported is not None and 0.0 < reported < elapsed_ms:
            elapsed_ms = reported
        self.latency_ms += elapsed_ms
        self.calls += 1
        self.answers.extend(result)
        return result

    async def aclose(self) -> None:
        """Closes the wrapped backend."""
        await self._inner.aclose()

    async def aclose_current_loop(self) -> None:
        """Closes resources bound to the current event loop on the wrapped backend."""
        await self._inner.aclose_current_loop()

    async def __aenter__(self) -> _BackendCallRecorder:
        """Enters the async context manager."""
        return self

    async def __aexit__(self, *_: object) -> None:
        """Closes the wrapped backend when exiting the async context manager."""
        await self.aclose()


def _abstained_compilation_output(
    recorder: _BackendCallRecorder, exc: A2uiCompilationError
) -> SynthesisOutput:
    """Builds an abstained `SynthesisOutput` when `synthesize` had no fallback."""
    err_str = str(exc)
    trace: list[DecisionRecord] = []
    if "(action_gate)" in err_str:
        trace.append(
            DecisionRecord(
                question=DecisionQuestion(
                    id="archetype_status",
                    kind=QuestionKind.BOOLEAN,
                    prompt="Action confidence gate",
                    allow_none=False,
                ),
                outcome="action_gate",
            )
        )
    if "(no_fit)" in err_str:
        trace.append(
            DecisionRecord(
                question=DecisionQuestion(
                    id="archetype_status",
                    kind=QuestionKind.BOOLEAN,
                    prompt="Family fit gate",
                    allow_none=False,
                ),
                outcome="no_fit",
            )
        )
    return SynthesisOutput(
        stage=SynthesisStage.ABSTAIN_FALLBACK,
        messages=[],
        confidence=0.0,
        entropy=0.0,
        fallback_reason=err_str,
        backend_kind=recorder.backend_kind,
        model_id=recorder.model_id,
        trace=tuple(trace),
        decision_latency_ms=recorder.latency_ms,
        decision_calls=recorder.calls,
        decision_answers=tuple(recorder.answers),
    )


def _tool_args_for_case(
    case: PlanCase, *, payload_override: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Builds `DecisionRenderTool.run_async` arguments from `case`."""
    args: dict[str, Any] = {
        "intent": case.intent,
        "payload": dict(
            payload_override if payload_override is not None else case.payload
        ),
    }
    if case.actions:
        args["actions"] = dict(case.actions)
    if case.exclude:
        args["exclude"] = list(case.exclude)
    if case.replace:
        args["replace"] = True
    if case.region is not None:
        args["region"] = case.region
    if case.labels:
        args["labels"] = dict(case.labels)
    if case.mutable_paths:
        args["mutablePaths"] = list(case.mutable_paths)
    if case.layout:
        args["layout"] = list(case.layout)
    if case.title is not None:
        args["title"] = case.title
    if case.summary is not None:
        args["summary"] = case.summary
    if case.fallback_dsl is not None:
        args["fallbackDsl"] = case.fallback_dsl
    return args


async def _synthesize_single_case(
    synth: DecisionSynthesizer, case: PlanCase
) -> tuple[SynthesisOutput, float]:
    """Runs `synth.synthesize` (or fresh `DecisionRenderTool` for `mode=='tool'`) on `case`."""
    original_backend = synth.backend
    recorder = _BackendCallRecorder(original_backend)
    synth.backend = recorder
    start = time.perf_counter()
    try:
        if case.mode == "tool":
            tool_synth = DecisionSynthesizer(
                synth.graph,
                recorder,
                config=synth.config,
                archetypes=synth.archetypes,
                patterns=synth.patterns,
                plan_cache=PlanCache(),
            )
            tool = DecisionRenderTool(tool_synth, name=case.effective_tool_name)
            output = await tool.run_async(_tool_args_for_case(case))
        else:
            op = SurfaceOperation.REPLACE if case.replace else SurfaceOperation.CREATE
            output = await synth.synthesize(
                case.intent,
                case.payload,
                actions=case.action_specs(),
                exclude=case.exclude,
                mutable_paths=case.mutable_paths,
                layout=case.layout or None,
                title=case.title,
                summary=case.summary,
                fallback_dsl=case.fallback_dsl,
                operation=op,
                labels=case.labels,
                region=case.region,
            )
        if not output.decision_answers and recorder.answers:
            output = replace(output, decision_answers=tuple(recorder.answers))
    except A2uiCompilationError as exc:
        output = _abstained_compilation_output(recorder, exc)
    finally:
        synth.backend = original_backend
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return output, elapsed_ms


def _observed_turn_operation(turn: PlanTurn, output: SynthesisOutput) -> str:
    """Maps `(turn, output)` to `'create' | 'update_root' | 'update_region' | 'replace'`."""
    if turn.region is not None and output.operation is SurfaceOperation.UPDATE_ROOT:
        return "update_region"
    return output.operation.value


async def _run_single_turn_step(
    synth: DecisionSynthesizer,
    turn: PlanTurn,
    state: RendererState,
) -> SynthesisOutput:
    """Executes one `PlanTurn` against `state` and applies emitted messages."""
    original_backend = synth.backend
    recorder = _BackendCallRecorder(original_backend)
    synth.backend = recorder
    op = SurfaceOperation.REPLACE if turn.replace else SurfaceOperation.CREATE
    try:
        out = await synth.synthesize(
            turn.intent,
            turn.payload,
            surface_id=turn.surface_id,
            actions=turn.action_specs(),
            exclude=turn.exclude,
            mutable_paths=turn.mutable_paths,
            layout=turn.layout or None,
            title=turn.title,
            summary=turn.summary,
            fallback_dsl=turn.fallback_dsl,
            operation=op,
            labels=turn.labels,
            region=turn.region,
            state=state,
        )
        if not out.decision_answers and recorder.answers:
            out = replace(out, decision_answers=tuple(recorder.answers))
    except A2uiCompilationError as exc:
        out = _abstained_compilation_output(recorder, exc)
    finally:
        synth.backend = original_backend
    if out.messages:
        state.apply(out.messages)
    return out


def _score_turn_step(
    idx: int, turn: PlanTurn, out: SynthesisOutput
) -> tuple[int, int, int, int]:
    """Returns `(op_hit, op_total, cache_hit, cache_opp)` for a single multi-turn step."""
    op_total = 1 if turn.expected_operation is not None else 0
    op_hit = (
        1
        if op_total and _observed_turn_operation(turn, out) == turn.expected_operation
        else 0
    )
    is_followup = idx > 0 and not turn.replace and turn.region is None
    is_opp = turn.expected_cache_hit is True or (
        turn.expected_cache_hit is None and is_followup
    )
    cache_opp = 1 if is_opp else 0
    cache_hit = 1 if is_opp and out.cache_hit else 0
    return op_hit, op_total, cache_hit, cache_opp


async def _evaluate_multi_turn_case(
    synth: DecisionSynthesizer, case: PlanCase
) -> tuple[CaseEvaluation, list[tuple[str, float, float]]]:
    """Executes `case.turns` on a shared `RendererState` + `PlanCache` and scores them."""
    state = RendererState(synth.graph.catalogs)
    turn_outputs: list[SynthesisOutput] = []
    all_components: list[dict[str, Any]] = []
    cache_hits = cache_opps = op_hits = op_total = 0

    start = time.perf_counter()
    for idx, turn in enumerate(case.turns):
        out = await _run_single_turn_step(synth, turn, state)
        turn_outputs.append(out)
        all_components.extend(_extract_rendered_components(out))
        oh, ot, ch, co = _score_turn_step(idx, turn, out)
        op_hits += oh
        op_total += ot
        cache_hits += ch
        cache_opps += co
    wall_ms = (time.perf_counter() - start) * 1000.0

    primary = turn_outputs[0]
    base_eval, cal_points = evaluate_single_run(case, primary, wall_ms)
    all_payloads = [case.payload, *(t.payload for t in case.turns)]
    leaked = _has_sensitive_leak(case.sensitive, all_payloads, all_components)
    total_calls = sum(o.decision_calls for o in turn_outputs)
    total_lat = sum(o.decision_latency_ms for o in turn_outputs)
    merged_out = replace(
        primary,
        decision_calls=total_calls,
        decision_latency_ms=total_lat,
    )
    return (
        replace(
            base_eval,
            output=merged_out,
            sensitive_leaked=base_eval.sensitive_leaked or leaked,
            surface_calls=total_calls,
            surface_count=len(turn_outputs),
            turn_latencies_ms=tuple(o.decision_latency_ms for o in turn_outputs),
            multi_turn_cache_hits=cache_hits,
            multi_turn_cache_opportunities=cache_opps,
            multi_turn_op_hits=op_hits,
            multi_turn_op_total=op_total,
        ),
        cal_points,
    )


async def _execute_case_once(
    synth: DecisionSynthesizer, case: PlanCase
) -> tuple[CaseEvaluation, list[tuple[str, float, float]]]:
    """Runs `case` once (multi-turn when `case.turns` is set, single-turn otherwise)."""
    if case.turns:
        return await _evaluate_multi_turn_case(synth, case)
    output, elapsed_ms = await _synthesize_single_case(synth, case)
    return evaluate_single_run(case, output, elapsed_ms)


async def run_case(
    synth: DecisionSynthesizer,
    case: PlanCase,
    *,
    repeat: int = 1,
) -> CaseScore:
    """Executes a decision synthesis case `repeat` times and scores results.

    Args:
        synth: Configured `DecisionSynthesizer` to benchmark.
        case: Ground-truth `PlanCase` to execute.
        repeat: Number of repeat executions to run.

    Returns:
        Aggregated `CaseScore` over `repeat` runs.
    """
    score = CaseScore(case=case, repeats=repeat)
    for _ in range(repeat):
        evaluation, _ = await _execute_case_once(synth, case)
        score.evaluations.append(evaluation)
    return score


def _empty_benchmark_summary(
    synth: DecisionSynthesizer, *, split_name: str = "all"
) -> BenchmarkSummary:
    """Returns a zeroed `BenchmarkSummary` when no cases were run."""
    return BenchmarkSummary(
        cases_count=0,
        total_runs=0,
        backend_kind=synth.backend.backend_kind,
        model_id=synth.backend.model_id,
        family_accuracy=0.0,
        archetype_accuracy=0.0,
        block_precision=0.0,
        block_recall=0.0,
        abstain_rate=0.0,
        fallback_rate=0.0,
        round_trips_per_surface=0.0,
        decision_latency_p50=0.0,
        decision_latency_p95=0.0,
        host_overhead_p50=0.0,
        host_overhead_p95=0.0,
        decision_calls_mean=0.0,
        brier_family=0.0,
        ece_family=0.0,
        brier_archetype=0.0,
        ece_archetype=0.0,
        brier_gates=0.0,
        ece_gates=0.0,
        split_name=split_name,
    )


async def _run_case_with_calibration(
    synth: DecisionSynthesizer, case: PlanCase, repeat: int
) -> tuple[CaseScore, list[tuple[str, float, float]]]:
    """Executes `case` `repeat` times and returns `(score, calibration_records)`."""
    score = CaseScore(case=case, repeats=repeat)
    records: list[tuple[str, float, float]] = []
    for _ in range(repeat):
        evaluation, cal_points = await _execute_case_once(synth, case)
        score.evaluations.append(evaluation)
        records.extend(cal_points)
    return score, records


def _group_calibration_pairs(
    records: Sequence[tuple[str, float, float]],
) -> dict[str, list[tuple[float, float]]]:
    """Groups `(kind, prob, target)` records by `kind`."""
    grouped: dict[str, list[tuple[float, float]]] = {
        "family": [],
        "archetype": [],
        "gate": [],
    }
    for kind, prob, target in records:
        if kind in grouped:
            grouped[kind].append((prob, target))
    return grouped


def _safe_ratio(numerator: float, denominator: float, *, empty: float = 0.0) -> float:
    """Divides `numerator` by `denominator`, returning `empty` when `denominator <= 0`."""
    return numerator / denominator if denominator > 0 else empty


def _mean_flag(evals: Sequence[CaseEvaluation], attr: str) -> float:
    """Computes the fraction of `evals` where boolean `getattr(e, attr)` is True."""
    if not evals:
        return 0.0
    return sum(1.0 for e in evals if getattr(e, attr)) / len(evals)


def _eval_turn_latencies(evals: Sequence[CaseEvaluation]) -> list[float]:
    """Flattens sorted per-turn decision latencies across `evals`."""
    out: list[float] = []
    for e in evals:
        if e.turn_latencies_ms:
            out.extend(e.turn_latencies_ms)
        else:
            out.append(e.output.decision_latency_ms)
    return sorted(out)


def _sum_attr(items: Sequence[Any], attr: str) -> float:
    """Sums numeric `getattr(x, attr)` across `items`."""
    return float(sum(getattr(x, attr) for x in items))


def _ratio_attrs(
    items: Sequence[Any], num_attr: str, den_attr: str, *, empty: float = 0.0
) -> float:
    """Computes `_safe_ratio(sum(num_attr), sum(den_attr), empty=empty)`."""
    return _safe_ratio(
        _sum_attr(items, num_attr), _sum_attr(items, den_attr), empty=empty
    )


def _partition_evals(
    evals: Sequence[CaseEvaluation],
) -> tuple[list[CaseEvaluation], list[CaseEvaluation], list[CaseEvaluation]]:
    """Splits `evals` into `(in_grammar, out_of_grammar, sensitive_evals)`."""
    in_gram: list[CaseEvaluation] = []
    out_gram: list[CaseEvaluation] = []
    sens_evals: list[CaseEvaluation] = []
    for ev in evals:
        if ev.out_of_grammar:
            out_gram.append(ev)
        else:
            in_gram.append(ev)
        if ev.has_sensitive:
            sens_evals.append(ev)
    return in_gram, out_gram, sens_evals


def _count_case_splits(cases: Sequence[PlanCase]) -> tuple[int, int, int]:
    """Returns `(in_grammar_count, out_of_grammar_count, unverified_count)`."""
    out_cnt = sum(1 for c in cases if c.is_out_of_grammar)
    unver_cnt = sum(1 for c in cases if not c.verified)
    return len(cases) - out_cnt, out_cnt, unver_cnt


def _summarize_evaluations(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    case_scores: list[CaseScore],
    all_evaluations: list[CaseEvaluation],
    calibration_records: Sequence[tuple[str, float, float]],
    *,
    fit_temp: bool,
    split_name: str = "all",
) -> BenchmarkSummary:
    """Computes `BenchmarkSummary` metrics over `all_evaluations`."""
    total_runs = len(all_evaluations)
    in_gram, out_gram, sens_evals = _partition_evals(all_evaluations)
    # In-grammar family and archetype accuracy are defined strictly over
    # in-grammar cases; out-of-grammar cases are scored via forced_fit_rate.
    acc_pool = in_gram
    in_cnt, out_cnt, unver_cnt = _count_case_splits(cases)

    latencies = _eval_turn_latencies(all_evaluations)
    overheads = sorted(e.host_overhead_ms for e in all_evaluations)
    round_trips = _ratio_attrs(all_evaluations, "surface_calls", "surface_count")
    grouped = _group_calibration_pairs(calibration_records)
    all_cal = grouped["family"] + grouped["archetype"] + grouped["gate"]

    return BenchmarkSummary(
        cases_count=len(cases),
        total_runs=total_runs,
        backend_kind=synth.backend.backend_kind,
        model_id=synth.backend.model_id,
        family_accuracy=_mean_flag(acc_pool, "family_correct"),
        archetype_accuracy=_mean_flag(acc_pool, "archetype_correct"),
        block_precision=_sum_attr(all_evaluations, "block_precision") / total_runs,
        block_recall=_sum_attr(all_evaluations, "block_recall") / total_runs,
        abstain_rate=_mean_flag(all_evaluations, "abstained"),
        fallback_rate=_mean_flag(all_evaluations, "used_fallback"),
        round_trips_per_surface=round_trips,
        decision_latency_p50=_percentile(latencies, 0.50),
        decision_latency_p95=_percentile(latencies, 0.95),
        host_overhead_p50=_percentile(overheads, 0.50),
        host_overhead_p95=_percentile(overheads, 0.95),
        decision_calls_mean=round_trips,
        brier_family=brier_score(grouped["family"]),
        ece_family=expected_calibration_error(grouped["family"]),
        brier_archetype=brier_score(grouped["archetype"]),
        ece_archetype=expected_calibration_error(grouped["archetype"]),
        brier_gates=brier_score(grouped["gate"]),
        ece_gates=expected_calibration_error(grouped["gate"]),
        forced_fit_rate=_mean_flag(out_gram, "forced_fit"),
        false_no_fit_rate=_mean_flag(in_gram, "is_no_fit"),
        slot_binding_accuracy=_ratio_attrs(
            all_evaluations, "slot_binding_hits", "slot_binding_total", empty=1.0
        ),
        sensitive_leak_rate=_mean_flag(sens_evals, "sensitive_leaked"),
        action_accuracy=_ratio_attrs(
            all_evaluations, "action_hits", "action_total", empty=1.0
        ),
        multi_turn_cache_hit_rate=_ratio_attrs(
            all_evaluations,
            "multi_turn_cache_hits",
            "multi_turn_cache_opportunities",
        ),
        multi_turn_operation_accuracy=_ratio_attrs(
            all_evaluations, "multi_turn_op_hits", "multi_turn_op_total", empty=1.0
        ),
        in_grammar_count=in_cnt,
        out_of_grammar_count=out_cnt,
        unverified_count=unver_cnt,
        split_name=split_name,
        fitted_temperature=fit_temperature(all_cal) if fit_temp else None,
        case_scores=case_scores,
    )


async def run_benchmark(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    *,
    repeat: int = 3,
    fit_temp: bool = False,
    split_name: str = "all",
) -> BenchmarkSummary:
    """Runs the benchmark across `cases` and summarizes accuracy, latency, and calibration.

    Args:
        synth: Configured `DecisionSynthesizer` to benchmark.
        cases: Sequence of ground-truth `PlanCase` entries to evaluate.
        repeat: Number of repeat runs per case.
        fit_temp: Whether to fit a calibration temperature over collected pairs.
        split_name: Split label recorded in the returned `BenchmarkSummary`.

    Returns:
        Aggregated `BenchmarkSummary` across all cases and repeats.
    """
    case_scores: list[CaseScore] = []
    all_evaluations: list[CaseEvaluation] = []
    calibration_records: list[tuple[str, float, float]] = []

    for case in cases:
        score, records = await _run_case_with_calibration(synth, case, repeat)
        case_scores.append(score)
        all_evaluations.extend(score.evaluations)
        calibration_records.extend(records)

    if not all_evaluations:
        return _empty_benchmark_summary(synth, split_name=split_name)

    return _summarize_evaluations(
        synth,
        cases,
        case_scores,
        all_evaluations,
        calibration_records,
        fit_temp=fit_temp,
        split_name=split_name,
    )


async def run_paraphrase_benchmark(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    *,
    repeat: int = 1,
    split_name: str = "all",
    baseline: BenchmarkSummary | None = None,
) -> ParaphraseComparison:
    """Runs `cases` with rewritten question prompts and compares against `baseline`.

    Args:
        synth: Configured `DecisionSynthesizer` to benchmark.
        cases: Sequence of `PlanCase` entries to evaluate.
        repeat: Number of repeat runs per case.
        split_name: Split label recorded in both summaries.
        baseline: Optional precomputed unparaphrased `BenchmarkSummary`.

    Returns:
        A `ParaphraseComparison` holding baseline and paraphrased summaries.
    """
    base_summary = baseline or await run_benchmark(
        synth, cases, repeat=repeat, split_name=split_name
    )
    paraphrase_backend = ParaphraseDecisionBackend(synth.backend)
    para_synth = DecisionSynthesizer(
        synth.graph,
        paraphrase_backend,
        registry=synth.registry,
        config=synth.config,
        archetypes=synth.archetypes,
        patterns=synth.patterns,
        plan_cache=PlanCache(),
    )
    para_summary = await run_benchmark(
        para_synth, cases, repeat=repeat, split_name=split_name
    )
    return ParaphraseComparison(baseline=base_summary, paraphrased=para_summary)


def _seed_scalar_for_template(value: Any) -> Any:
    """Mutates a scalar value while preserving semantic type hints."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return value + 1
    if isinstance(value, float):
        return round(value * 0.9 + 0.01, 4)
    if (
        isinstance(value, str)
        and "://" not in value
        and "@" not in value
        and len(value) >= 4
    ):
        return f"seed_{value}"
    return value


def _seed_value_for_template(value: Any) -> Any:
    """Produces a distinct seed payload of identical pointer shape and types."""
    if isinstance(value, Mapping):
        return {k: _seed_value_for_template(v) for k, v in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return [_seed_value_for_template(v) for v in value]
    return _seed_scalar_for_template(value)


async def _evaluate_promoted_tool_case(
    synth: DecisionSynthesizer,
    case: PlanCase,
    repeat: int,
) -> tuple[CaseScore, list[tuple[str, float, float]]]:
    """Promotes `case` on a seed payload via `DecisionRenderTool.promote` and scores `repeat` runs."""
    registry = TemplateRegistry()
    seed_tool = DecisionRenderTool.create(
        synth.graph,
        backend=synth.backend,
        registry=registry,
        config=synth.config,
        archetypes=synth.archetypes,
        patterns=synth.patterns,
        plan_cache=PlanCache(),
        name=case.effective_tool_name,
    )
    seed_payload = _seed_value_for_template(case.payload)
    try:
        seed_out = await seed_tool.run_async(
            _tool_args_for_case(case, payload_override=seed_payload)
        )
    except A2uiCompilationError:
        seed_out = None

    promoted_tpl = None
    if (
        seed_out is not None
        and seed_out.layout_plan is not None
        and seed_out.fallback_source is None
    ):
        promoted_tpl = seed_tool.promote(
            f"{case.effective_tool_name}_tpl",
            case.intent,
            is_mutable=bool(case.mutable_paths),
        )

    score = CaseScore(case=case, repeats=repeat)
    records: list[tuple[str, float, float]] = []
    avail_ptrs = {
        p.path
        for p in inspect_payload_pointers(
            case.payload, mutable_paths=case.mutable_paths
        )
    }

    for _ in range(repeat):
        t0 = time.perf_counter()
        if (
            promoted_tpl is not None
            and seed_out is not None
            and promoted_tpl.matches_payload(avail_ptrs)
        ):
            msgs = promoted_tpl.render_messages(case.payload, surface_id="main")
            out = SynthesisOutput(
                stage=SynthesisStage.TEMPLATE_SELECT,
                messages=msgs,
                confidence=seed_out.confidence,
                entropy=seed_out.entropy,
                selected_template_id=promoted_tpl.template_id,
                layout_plan=seed_out.layout_plan,
                trace=seed_out.trace,
                decision_answers=seed_out.decision_answers,
                backend_kind=synth.backend.backend_kind,
                model_id=synth.backend.model_id,
                decision_calls=0,
                decision_latency_ms=0.0,
            )
            wall_ms = (time.perf_counter() - t0) * 1000.0
        else:
            out, wall_ms = await _synthesize_single_case(synth, case)
        ev, cal_pts = evaluate_single_run(case, out, wall_ms)
        score.evaluations.append(ev)
        records.extend(cal_pts)
    return score, records


async def run_template_arm_benchmark(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    *,
    repeat: int = 1,
    split_name: str = "all",
) -> TemplateArmComparison:
    """Compares unpromoted `DecisionRenderTool` planning against promoted `SurfaceTemplate` rendering.

    Args:
        synth: Configured `DecisionSynthesizer` to benchmark.
        cases: Candidate `PlanCase` entries (filtered to in-grammar `mode == 'tool'`).
        repeat: Number of repeat runs per tool case.
        split_name: Split label recorded in both arm summaries.

    Returns:
        A `TemplateArmComparison` contrasting unpromoted planner and template arms.
    """
    tool_cases = [c for c in cases if c.mode == "tool" and not c.is_out_of_grammar]
    if not tool_cases:
        empty = _empty_benchmark_summary(synth, split_name=split_name)
        return TemplateArmComparison(
            tool_cases_count=0, planner_arm=empty, template_arm=empty
        )

    planner_summary = await run_benchmark(
        synth, tool_cases, repeat=repeat, split_name=split_name
    )
    tpl_scores: list[CaseScore] = []
    tpl_evals: list[CaseEvaluation] = []
    tpl_cal: list[tuple[str, float, float]] = []
    for case in tool_cases:
        cs, recs = await _evaluate_promoted_tool_case(synth, case, repeat)
        tpl_scores.append(cs)
        tpl_evals.extend(cs.evaluations)
        tpl_cal.extend(recs)

    template_summary = _summarize_evaluations(
        synth,
        tool_cases,
        tpl_scores,
        tpl_evals,
        tpl_cal,
        fit_temp=False,
        split_name=split_name,
    )
    return TemplateArmComparison(
        tool_cases_count=len(tool_cases),
        planner_arm=planner_summary,
        template_arm=template_summary,
    )


def _format_case_row(cs: CaseScore) -> str:
    """Formats one per-case row in the Markdown benchmark report."""
    fam_mark = "pass" if cs.family_accuracy >= 1.0 else f"{cs.family_accuracy:.0%}"
    arch_mark = (
        "pass" if cs.archetype_accuracy >= 1.0 else f"{cs.archetype_accuracy:.0%}"
    )
    return (
        f"| `{cs.case.name}` | {fam_mark} | {arch_mark} |"
        f" {cs.slot_binding_accuracy:.0%} | {cs.action_accuracy:.0%} |"
        f" {cs.block_recall:.0%} | {cs.block_precision:.0%} |"
        f" {cs.round_trips_per_surface:.2f} | {cs.decision_latency_p50:.1f} |"
        f" {cs.fallback_rate:.0%} |"
    )


def render_markdown(summary: BenchmarkSummary, backend_name: str | None = None) -> str:
    """Renders a Markdown report with all Wave 6 metrics from `summary`.

    Args:
        summary: Aggregated `BenchmarkSummary` to format.
        backend_name: Optional custom label for the report heading.

    Returns:
        Formatted Markdown report text.
    """
    header_label = backend_name or f"{summary.backend_kind}/{summary.model_id}"
    profile_key = f"{summary.backend_kind}/{summary.model_id}"
    lines: list[str] = [
        (
            f"## Decision model benchmark summary: `{header_label}` (split:"
            f" `{summary.split_name}`)"
        ),
        "",
    ]
    if summary.unverified_count > 0:
        lines.extend([
            (
                f"> **[UNFROZEN HELDOUT]** {summary.unverified_count} of"
                f" {summary.cases_count} evaluated cases have `verified: false`"
                " (pending human label review)."
            ),
            "",
        ])
    lines.extend([
        f"- Backend: `{summary.backend_kind}` (model `{summary.model_id}`)",
        (
            f"- Cases evaluated: {summary.cases_count}"
            f" ({summary.in_grammar_count} in-grammar,"
            f" {summary.out_of_grammar_count} out-of-grammar,"
            f" {summary.unverified_count} unverified; {summary.total_runs} runs)"
        ),
        f"- Family accuracy: {summary.family_accuracy * 100.0:.1f}%",
        f"- Archetype accuracy: {summary.archetype_accuracy * 100.0:.1f}%",
        (
            f"- Forced-fit rate: {summary.forced_fit_rate * 100.0:.1f}%"
            f" (target <= {FORCED_FIT_TARGET * 100.0:.0f}%)"
        ),
        (
            f"- False no-fit rate: {summary.false_no_fit_rate * 100.0:.1f}%"
            f" (target <= {FALSE_NO_FIT_TARGET * 100.0:.0f}%)"
        ),
        f"- Slot binding accuracy: {summary.slot_binding_accuracy * 100.0:.1f}%",
        f"- Action accuracy: {summary.action_accuracy * 100.0:.1f}%",
        f"- Sensitive leak rate: {summary.sensitive_leak_rate * 100.0:.1f}%",
        f"- Block precision: {summary.block_precision * 100.0:.1f}%",
        f"- Block recall: {summary.block_recall * 100.0:.1f}%",
        (
            "- Multi-turn cache hit rate:"
            f" {summary.multi_turn_cache_hit_rate * 100.0:.1f}%"
        ),
        (
            "- Multi-turn operation accuracy:"
            f" {summary.multi_turn_operation_accuracy * 100.0:.1f}%"
        ),
        f"- Fallback rate: {summary.fallback_rate * 100.0:.1f}%",
        f"- Abstain rate: {summary.abstain_rate * 100.0:.1f}%",
        "",
        "### Latency and round trips",
        "",
        (
            f"- Decision latency (p50 / p95): {summary.decision_latency_p50:.1f} ms"
            f" / {summary.decision_latency_p95:.1f} ms"
        ),
        (
            f"- Host overhead (p50 / p95): {summary.host_overhead_p50:.1f} ms /"
            f" {summary.host_overhead_p95:.1f} ms"
        ),
        f"- Round trips per surface: {summary.round_trips_per_surface:.2f}",
        "",
        "### Calibration",
        "",
        "| Question kind | Brier score | ECE (10-bin) |",
        "| :--- | :--- | :--- |",
        f"| Family | {summary.brier_family:.4f} | {summary.ece_family:.4f} |",
        f"| Archetype | {summary.brier_archetype:.4f} | {summary.ece_archetype:.4f} |",
        f"| Gates | {summary.brier_gates:.4f} | {summary.ece_gates:.4f} |",
    ])
    if summary.fitted_temperature is not None:
        profile_json = json.dumps(
            {profile_key: {"temperature": summary.fitted_temperature}}
        )
        lines.extend([
            "",
            "### Fitted calibration profile",
            "",
            f"Profile entry: `{profile_json}`",
        ])

    lines.extend([
        "",
        "### Case breakdown",
        "",
        (
            "| Case | Family | Archetype | Bindings | Actions | Recall | Prec |"
            " Round trips | Backend ms | Fallback |"
        ),
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
        *(_format_case_row(cs) for cs in summary.case_scores),
    ])
    return "\n".join(lines)


def render_paraphrase_markdown(comp: ParaphraseComparison) -> str:
    """Renders a Markdown table comparing baseline vs paraphrased prompts.

    Args:
        comp: `ParaphraseComparison` holding baseline and paraphrased runs.

    Returns:
        Formatted Markdown comparison table.
    """
    b = comp.baseline
    p = comp.paraphrased
    return "\n".join([
        "### Paraphrase sensitivity",
        "",
        "| Metric | Unparaphrased | Paraphrased | Delta |",
        "| :--- | :--- | :--- | :--- |",
        (
            f"| Family accuracy | {b.family_accuracy * 100.0:.1f}% |"
            f" {p.family_accuracy * 100.0:.1f}% |"
            f" {comp.family_accuracy_delta * 100.0:+.1f} pp |"
        ),
        (
            f"| Archetype accuracy | {b.archetype_accuracy * 100.0:.1f}% |"
            f" {p.archetype_accuracy * 100.0:.1f}% |"
            f" {comp.archetype_accuracy_delta * 100.0:+.1f} pp |"
        ),
        (
            f"| Slot binding accuracy | {b.slot_binding_accuracy * 100.0:.1f}% |"
            f" {p.slot_binding_accuracy * 100.0:.1f}% |"
            f" {comp.slot_binding_accuracy_delta * 100.0:+.1f} pp |"
        ),
        (
            f"| Forced-fit rate | {b.forced_fit_rate * 100.0:.1f}% |"
            f" {p.forced_fit_rate * 100.0:.1f}% |"
            f" {comp.forced_fit_rate_delta * 100.0:+.1f} pp |"
        ),
        (
            f"| False no-fit rate | {b.false_no_fit_rate * 100.0:.1f}% |"
            f" {p.false_no_fit_rate * 100.0:.1f}% |"
            f" {comp.false_no_fit_rate_delta * 100.0:+.1f} pp |"
        ),
    ])


def render_template_arm_markdown(comp: TemplateArmComparison) -> str:
    """Renders a Markdown table comparing unpromoted planner vs promoted template arm.

    Args:
        comp: `TemplateArmComparison` holding planner and template arm summaries.

    Returns:
        Formatted Markdown comparison table.
    """
    pl = comp.planner_arm
    tp = comp.template_arm
    return "\n".join([
        f"### Tool-mode template arm (`{comp.tool_cases_count}` tool cases)",
        "",
        (
            "| Arm | Family Acc | Archetype Acc | Slot Bind | Action Acc | Sens Leak |"
            " Round Trips | P50 (ms) | P95 (ms) |"
        ),
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
        (
            f"| Planner (unpromoted) | {pl.family_accuracy * 100.0:.1f}% |"
            f" {pl.archetype_accuracy * 100.0:.1f}% |"
            f" {pl.slot_binding_accuracy * 100.0:.1f}% |"
            f" {pl.action_accuracy * 100.0:.1f}% |"
            f" {pl.sensitive_leak_rate * 100.0:.1f}% |"
            f" {pl.round_trips_per_surface:.2f} |"
            f" {pl.decision_latency_p50:.1f} | {pl.decision_latency_p95:.1f} |"
        ),
        (
            f"| Promoted template | {tp.family_accuracy * 100.0:.1f}% |"
            f" {tp.archetype_accuracy * 100.0:.1f}% |"
            f" {tp.slot_binding_accuracy * 100.0:.1f}% |"
            f" {tp.action_accuracy * 100.0:.1f}% |"
            f" {tp.sensitive_leak_rate * 100.0:.1f}% |"
            f" {tp.round_trips_per_surface:.2f} |"
            f" {tp.decision_latency_p50:.1f} | {tp.decision_latency_p95:.1f} |"
        ),
    ])


def serialize_benchmark_summary(summary: BenchmarkSummary) -> dict[str, Any]:
    """Serializes `summary` into a JSON-compatible dictionary.

    Args:
        summary: `BenchmarkSummary` to serialize.

    Returns:
        JSON-serializable dictionary of aggregate and per-case metrics.
    """
    return {
        "backend_kind": summary.backend_kind,
        "model_id": summary.model_id,
        "split": summary.split_name,
        "cases_count": summary.cases_count,
        "in_grammar_count": summary.in_grammar_count,
        "out_of_grammar_count": summary.out_of_grammar_count,
        "unverified_count": summary.unverified_count,
        "total_runs": summary.total_runs,
        "family_accuracy": summary.family_accuracy,
        "archetype_accuracy": summary.archetype_accuracy,
        "forced_fit_rate": summary.forced_fit_rate,
        "false_no_fit_rate": summary.false_no_fit_rate,
        "slot_binding_accuracy": summary.slot_binding_accuracy,
        "sensitive_leak_rate": summary.sensitive_leak_rate,
        "action_accuracy": summary.action_accuracy,
        "block_precision": summary.block_precision,
        "block_recall": summary.block_recall,
        "multi_turn_cache_hit_rate": summary.multi_turn_cache_hit_rate,
        "multi_turn_operation_accuracy": summary.multi_turn_operation_accuracy,
        "abstain_rate": summary.abstain_rate,
        "fallback_rate": summary.fallback_rate,
        "mean_round_trips": summary.mean_round_trips,
        "round_trips_per_surface": summary.round_trips_per_surface,
        "p50_latency_ms": summary.p50_latency_ms,
        "p95_latency_ms": summary.p95_latency_ms,
        "decision_latency_p50": summary.decision_latency_p50,
        "decision_latency_p95": summary.decision_latency_p95,
        "host_overhead_p50": summary.host_overhead_p50,
        "host_overhead_p95": summary.host_overhead_p95,
        "decision_calls_mean": summary.decision_calls_mean,
        "brier_family": summary.brier_family,
        "ece_family": summary.ece_family,
        "brier_archetype": summary.brier_archetype,
        "ece_archetype": summary.ece_archetype,
        "brier_gates": summary.brier_gates,
        "ece_gates": summary.ece_gates,
        "fitted_temperature": summary.fitted_temperature,
        "cases": [
            {
                "name": cs.case.name,
                "split": cs.case.split,
                "verified": cs.case.verified,
                "family_accuracy": cs.family_accuracy,
                "archetype_accuracy": cs.archetype_accuracy,
                "forced_fit_rate": cs.forced_fit_rate,
                "false_no_fit_rate": cs.false_no_fit_rate,
                "slot_binding_accuracy": cs.slot_binding_accuracy,
                "action_accuracy": cs.action_accuracy,
                "sensitive_leak_rate": cs.sensitive_leak_rate,
                "block_precision": cs.block_precision,
                "block_recall": cs.block_recall,
                "abstain_rate": cs.abstain_rate,
                "fallback_rate": cs.fallback_rate,
                "round_trips_per_surface": cs.round_trips_per_surface,
                "decision_latency_p50": cs.decision_latency_p50,
                "host_overhead_p50": cs.host_overhead_p50,
            }
            for cs in summary.case_scores
        ],
    }
