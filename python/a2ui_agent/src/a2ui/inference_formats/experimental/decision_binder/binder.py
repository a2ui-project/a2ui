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

"""Decision-model pointer binder for Express, `@macro`, and Client-Side Templates."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.decision import (
    ActionSpec,
    CatalogDecisionGraph,
    ComponentKey,
    ComponentNodeSpec,
    ComponentSlot,
    DecisionAnswer,
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    ExpressSurfaceSpec,
    PointerSummary,
    QuestionKind,
    SemanticType,
    SlotKind,
    build_inference_catalogs,
    coerce_decision_payload,
    inspect_pointers,
    is_secret_pointer,
    lower_for_transport,
)
from a2ui.inference_formats.express import ExpressCompiler
from a2ui.utils import RendererState
from a2ui.utils._experimental import experimental

DEFAULT_MIN_CONFIDENCE = 0.65
DEFAULT_MAX_PAIRS = 400
_ARRAY_PAYLOAD_KEY = "items"
_DEFAULT_MACRO_CATALOG_ID = "https://a2ui.org/catalogs/macros"
_BASIC_CATALOG_V1_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

_FORBIDDEN_MACRO_REFS: tuple[str, ...] = (
    "Child",
    "ComponentId",
    "ChildList",
    "CheckRule",
    "AccessibilityAttributes",
    "FunctionCall",
    "Extensions",
)
_SUPPORTED_SLOT_KINDS = frozenset({
    SlotKind.DATA_VALUE,
    SlotKind.LITERAL_PRIMITIVE,
    SlotKind.STATIC_ENUM,
    SlotKind.ACTION,
})


@dataclass(frozen=True)
class BindResult:
    """Outcome of binding a tool output onto a registered A2UI surface target.

    Attributes:
        messages: Validated A2UI v1.0 wire messages, or empty when abstained.
        abstained: Whether the binder declined to synthesize a surface.
        reason: Human-readable explanation when `abstained` is True.
        target_id: Selected target key (`express:<id>` or
            `<catalog_id>:<component_name>`), or None when abstained.
        confidence: Winning target probability from `select:target`.
        bindings: Bound slot values for a component target, or empty for
            Express surfaces or abstentions.
        decision_calls: Number of backend `answer` calls made (0, 1, or 2).
    """

    messages: list[AgentToRendererMessage] = field(default_factory=list)
    abstained: bool = False
    reason: str = ""
    target_id: str | None = None
    confidence: float = 0.0
    bindings: Mapping[str, Any] = field(default_factory=dict)
    decision_calls: int = 0


@dataclass(frozen=True)
class _TargetSpec:
    """Normalized internal target entry (Express surface, macro, or CST)."""

    target_key: str
    kind: Literal["express", "component"]
    description: str
    express: ExpressSurfaceSpec | None = None
    node: ComponentNodeSpec | None = None
    is_macro: bool = False
    integer_slots: frozenset[str] = frozenset()
    enum_value_map: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)


def _escape_json_pointer_token(token: str) -> str:
    """Escapes one RFC 6901 JSON Pointer segment."""
    return token.replace("~", "~0").replace("/", "~1")


def _is_excluded_pointer(path: str, exclude: Collection[str]) -> bool:
    """Returns whether `path` equals or is nested under any entry in `exclude`."""
    return any(path == ex or path.startswith(f"{ex}/") for ex in exclude)


def _is_mutable_pointer(path: str, mutable_set: set[str]) -> bool:
    """Returns whether `path` or a parent prefix is listed in `mutable_set`."""
    return any(path == mp or path.startswith(f"{mp}/") for mp in mutable_set)


def _is_redacted_field(
    path: str,
    key: str,
    exclude: Collection[str],
    mutable_set: set[str],
) -> bool:
    """Returns whether a mapping field must be omitted from `updateDataModel`."""
    if _is_excluded_pointer(path, exclude):
        return True
    if _is_mutable_pointer(path, mutable_set):
        return False
    probe = PointerSummary(path=path, value_type="string", cardinality=1, key=key)
    return is_secret_pointer(probe)


def _redact_value(
    value: Any,
    prefix: str,
    exclude: Collection[str],
    mutable_set: set[str],
) -> Any:
    """Recursively copies `value`, stripping excluded paths and non-mutable secrets."""
    if isinstance(value, Mapping):
        cleaned: dict[str, Any] = {}
        for raw_key, child in value.items():
            key_str = str(raw_key)
            child_path = f"{prefix}/{_escape_json_pointer_token(key_str)}"
            if _is_redacted_field(child_path, key_str, exclude, mutable_set):
                continue
            cleaned[key_str] = _redact_value(child, child_path, exclude, mutable_set)
        return cleaned
    if isinstance(value, list):
        return [
            _redact_value(item, f"{prefix}/{idx}", exclude, mutable_set)
            for idx, item in enumerate(value)
            if not _is_excluded_pointer(f"{prefix}/{idx}", exclude)
        ]
    return value


def _redact_data_model(
    data_model: Mapping[str, Any],
    *,
    exclude: Collection[str] = (),
    mutable_paths: Collection[str] = (),
) -> dict[str, Any]:
    """Returns a copy of `data_model` with excluded and secret fields removed."""
    mutable_set = {str(p) for p in mutable_paths}
    return dict(_redact_value(data_model, "", exclude, mutable_set))


def _is_basic_catalog(catalog: CatalogApi) -> bool:
    """Returns whether `catalog` is the built-in A2UI BasicCatalog."""
    return (
        catalog.catalog_id == _BASIC_CATALOG_V1_ID
        or type(catalog).__name__ == "BasicCatalog"
    )


def _ref_ends_with(ref: str, suffixes: tuple[str, ...]) -> str | None:
    """Returns the matching suffix if `$ref` targets any forbidden definition."""
    for suffix in suffixes:
        if ref == suffix or ref.endswith(f"/{suffix}"):
            return suffix
    return None


def _combinator_subschemas(schema: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Returns mapping sub-schemas nested inside `oneOf`, `anyOf`, or `allOf`."""
    subs: list[Mapping[str, Any]] = []
    for combinator in ("oneOf", "anyOf", "allOf"):
        raw = schema.get(combinator)
        if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
            subs.extend(item for item in raw if isinstance(item, Mapping))
    return subs


def _forbidden_schema_reason(schema: Mapping[str, Any]) -> str | None:
    """Returns an error reason if a macro parameter schema uses an unsupported type."""
    direct_ref = schema.get("$ref")
    if isinstance(direct_ref, str):
        hit = _ref_ends_with(direct_ref, _FORBIDDEN_MACRO_REFS)
        if hit is not None:
            return f"unsupported $ref '{hit}'"
    schema_type = schema.get("type")
    if schema_type == "object":
        return "nested object/model parameter"
    if schema_type == "array":
        return "array/list parameter (use DynamicStringList for bindable string lists)"
    for sub in _combinator_subschemas(schema):
        nested_reason = _forbidden_schema_reason(sub)
        if nested_reason is not None:
            return nested_reason
    return None


def _validate_macro_registration(fn: Callable[..., Any]) -> str:
    """Validates `@macro` parameter schemas at registration time.

    Raises:
        A2uiCatalogError: If `fn` is not a `@macro` or declares unsupported
            `Child`, `ChildList`, `CheckRule`, or nested model parameters.
    """
    meta = getattr(fn, "__a2ui_macro__", None)
    if meta is None or not isinstance(getattr(meta, "name", None), str):
        raise A2uiCatalogError(f"Macro target {fn!r} must be decorated with @macro.")
    macro_name = str(meta.name)
    schema = meta.to_json_schema(use_v1_0=True)
    props = schema.get("properties", {})
    if isinstance(props, Mapping):
        for param_name, param_schema in props.items():
            if not isinstance(param_schema, Mapping):
                continue
            reason = _forbidden_schema_reason(param_schema)
            if reason is not None:
                raise A2uiCatalogError(
                    f"Macro '{macro_name}' parameter '{param_name}' is not supported"
                    f" by ToolPointerBinder ({reason})."
                )
    return macro_name


def _missing_required_slot_names(
    graph: CatalogDecisionGraph, node: ComponentNodeSpec
) -> tuple[str, ...]:
    """Returns required schema properties on `node` that are not classified slots."""
    helper = graph.helpers().get(node.catalog_id)
    if helper is None:
        return ()
    slot_names = {slot.name for slot in node.slots}
    required = set(helper.get_component_required(node.name)) - {"component", "id"}
    return tuple(sorted(required - slot_names))


def _validate_macro_node_slots(
    graph: CatalogDecisionGraph, macro_name: str, node: ComponentNodeSpec
) -> None:
    """Validates that a registered macro exposes bindable data or action slots."""
    for slot in node.slots:
        if slot.kind not in _SUPPORTED_SLOT_KINDS:
            raise A2uiCatalogError(
                f"Macro '{macro_name}' slot '{slot.name}' has unsupported kind"
                f" '{slot.kind.value}'."
            )
    missing_required = _missing_required_slot_names(graph, node)
    if missing_required:
        raise A2uiCatalogError(
            f"Macro '{macro_name}' has required properties with unsupported slot"
            f" schemas: {', '.join(missing_required)}."
        )
    has_bindable = any(
        slot.kind in (SlotKind.DATA_VALUE, SlotKind.ACTION) for slot in node.slots
    )
    if not has_bindable:
        raise A2uiCatalogError(
            f"Macro '{macro_name}' must declare at least one Dynamic* data or Action"
            " parameter for ToolPointerBinder."
        )


def _read_enum_value_map(
    helper: Any,
    comp_name: str,
    slot_name: str,
    prop_schema: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Reads string-to-native enum values for one `STATIC_ENUM` slot."""
    raw_enum = helper.get_property_enum(comp_name, slot_name) or prop_schema.get("enum")
    if isinstance(raw_enum, Sequence) and not isinstance(raw_enum, (str, bytes)):
        return {str(val): val for val in raw_enum}
    return None


def _extract_slot_schema_hints(
    graph: CatalogDecisionGraph, node: ComponentNodeSpec
) -> tuple[frozenset[str], dict[str, dict[str, Any]]]:
    """Reads integer-type flags and raw enum values for `node`'s slots."""
    helper = graph.helpers().get(node.catalog_id)
    if helper is None:
        return frozenset(), {}
    integer_slots: set[str] = set()
    enum_value_map: dict[str, dict[str, Any]] = {}
    for slot in node.slots:
        prop_schema = helper.get_property_schema(node.name, slot.name)
        if not isinstance(prop_schema, Mapping):
            continue
        if (
            slot.kind is SlotKind.LITERAL_PRIMITIVE
            and prop_schema.get("type") == "integer"
        ):
            integer_slots.add(slot.name)
        if slot.kind is SlotKind.STATIC_ENUM:
            mapped = _read_enum_value_map(helper, node.name, slot.name, prop_schema)
            if mapped is not None:
                enum_value_map[slot.name] = mapped
    return frozenset(integer_slots), enum_value_map


def _make_component_target(
    graph: CatalogDecisionGraph,
    node: ComponentNodeSpec,
    *,
    is_macro: bool,
) -> _TargetSpec:
    """Wraps a `ComponentNodeSpec` into an internal `_TargetSpec`."""
    integer_slots, enum_value_map = _extract_slot_schema_hints(graph, node)
    desc = node.description.strip() or node.name
    return _TargetSpec(
        target_key=f"{node.catalog_id}:{node.name}",
        kind="component",
        description=f"{node.name}: {desc}",
        node=node,
        is_macro=is_macro,
        integer_slots=integer_slots,
        enum_value_map=enum_value_map,
    )


def _is_bindable_component(
    graph: CatalogDecisionGraph, node: ComponentNodeSpec
) -> bool:
    """Returns whether a catalog component has only Wave 1-supported bindable slots."""
    if not node.slots or node.is_container:
        return False
    if not all(slot.kind in _SUPPORTED_SLOT_KINDS for slot in node.slots):
        return False
    return not _missing_required_slot_names(graph, node)


def _normalize_tool_output(tool_output: Any) -> dict[str, Any] | None:
    """Normalizes a mapping, root sequence, or JSON string into a root data dict."""
    if isinstance(tool_output, str):
        try:
            coerced = coerce_decision_payload(tool_output)
        except (TypeError, ValueError):
            return None
        tool_output = coerced
    if isinstance(tool_output, Mapping):
        return dict(tool_output)
    if isinstance(tool_output, Sequence) and not isinstance(
        tool_output, (str, bytes, bytearray)
    ):
        return {_ARRAY_PAYLOAD_KEY: list(tool_output)}
    return None


def _step_json_pointer(current: Any, segment: str) -> tuple[bool, Any]:
    """Advances one unescaped RFC 6901 segment over a mapping or sequence."""
    if isinstance(current, Mapping):
        return (True, current[segment]) if segment in current else (False, None)
    if isinstance(current, Sequence) and not isinstance(
        current, (str, bytes, bytearray)
    ):
        if segment.isdigit():
            idx = int(segment)
            if 0 <= idx < len(current):
                return True, current[idx]
    return False, None


def _resolve_json_pointer(data: Any, pointer: str) -> tuple[bool, Any]:
    """Resolves an RFC 6901 JSON Pointer against `data`, returning `(found, value)`."""
    if not pointer or pointer == "/":
        return True, data
    if not pointer.startswith("/"):
        return False, None
    current: Any = data
    for raw_seg in pointer[1:].split("/"):
        seg = raw_seg.replace("~1", "/").replace("~0", "~")
        found, current = _step_json_pointer(current, seg)
        if not found:
            return False, None
    return True, current


def _normalize_actions(actions: Sequence[ActionSpec | str]) -> tuple[ActionSpec, ...]:
    """Converts string or `ActionSpec` entries into a normalized tuple."""
    normalized: list[ActionSpec] = []
    seen: set[str] = set()
    for item in actions:
        spec = item if isinstance(item, ActionSpec) else ActionSpec(id=item, label=item)
        if spec.id not in seen:
            seen.add(spec.id)
            normalized.append(spec)
    return tuple(normalized)


def _is_integer_value(value: Any) -> bool:
    """Returns True if `value` is an int (not bool) or an integral float."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def _pointer_matches_slot(
    ptr: PointerSummary,
    slot: ComponentSlot,
    data_model: Mapping[str, Any],
    *,
    integer_only: bool,
) -> bool:
    """Returns whether `ptr` is type-compatible with `slot`."""
    expected = slot.value_type
    if expected in (None, "any"):
        return ptr.value_type != "object"
    if ptr.value_type != expected:
        return False
    if integer_only and expected == "number":
        found, val = _resolve_json_pointer(data_model, ptr.path)
        return found and _is_integer_value(val)
    return True


def _compatible_pointers(
    slot: ComponentSlot,
    pointers: Sequence[PointerSummary],
    data_model: Mapping[str, Any],
    *,
    integer_only: bool = False,
) -> list[tuple[str, str]]:
    """Collects `(path, description)` pairs compatible with `slot`."""
    matches: list[tuple[str, str]] = []
    seen_paths: set[str] = set()
    for ptr in pointers:
        if _pointer_matches_slot(ptr, slot, data_model, integer_only=integer_only):
            seen_paths.add(ptr.path)
            matches.append((
                ptr.path,
                f"{ptr.path} ({ptr.semantic_type.value}, label={ptr.label})",
            ))
    if slot.kind is SlotKind.DATA_VALUE and slot.value_type in ("string", "any", None):
        for ptr in pointers:
            for sample_path in ptr.sample_pointers:
                if sample_path not in seen_paths:
                    seen_paths.add(sample_path)
                    matches.append((sample_path, f"{sample_path} (sample image_url)"))
    return matches


def _build_pointer_slot_question(
    qid: str,
    node_name: str,
    target: _TargetSpec,
    slot: ComponentSlot,
    desc_suffix: str,
    pointers: Sequence[PointerSummary],
    data_model: Mapping[str, Any],
) -> tuple[DecisionQuestion | None, bool]:
    """Builds a `CHOICE` question binding a data or literal primitive slot to a pointer."""
    integer_only = slot.name in target.integer_slots
    matches = _compatible_pointers(
        slot, pointers, data_model, integer_only=integer_only
    )
    if not matches:
        return None, not slot.required
    return (
        DecisionQuestion(
            id=qid,
            kind=QuestionKind.CHOICE,
            prompt=(
                f"Bind payload pointer for '{slot.name}' of '{node_name}'.{desc_suffix}"
            ),
            options=tuple(path for path, _ in matches),
            option_texts=tuple(text for _, text in matches),
            allow_none=not slot.required,
        ),
        True,
    )


def _build_slot_question(
    target: _TargetSpec,
    slot: ComponentSlot,
    pointers: Sequence[PointerSummary],
    data_model: Mapping[str, Any],
    actions: Sequence[ActionSpec],
) -> tuple[DecisionQuestion | None, bool]:
    """Builds a `DecisionQuestion` for one component slot.

    Returns:
        `(question, eligible)`. `eligible` is False when a required slot has
        no valid candidate options.
    """
    node_name = target.node.name if target.node is not None else target.target_key
    qid = f"bind:{target.target_key}:{slot.name}"
    desc_suffix = f" ({slot.description})" if slot.description else ""

    if slot.kind is SlotKind.LITERAL_PRIMITIVE and slot.value_type == "boolean":
        return (
            DecisionQuestion(
                id=qid,
                kind=QuestionKind.BOOLEAN,
                prompt=(
                    f"Should boolean parameter '{slot.name}' of '{node_name}' be true?"
                    f"{desc_suffix}"
                ),
            ),
            True,
        )

    if slot.kind is SlotKind.STATIC_ENUM:
        if not slot.enum_values:
            return None, not slot.required
        return (
            DecisionQuestion(
                id=qid,
                kind=QuestionKind.CHOICE,
                prompt=(
                    f"Select enum value for '{slot.name}' of '{node_name}'."
                    f"{desc_suffix}"
                ),
                options=slot.enum_values,
                allow_none=not slot.required,
            ),
            True,
        )

    if slot.kind is SlotKind.ACTION:
        if not actions:
            return None, not slot.required
        return (
            DecisionQuestion(
                id=qid,
                kind=QuestionKind.CHOICE,
                prompt=(
                    f"Select action for '{slot.name}' of '{node_name}'.{desc_suffix}"
                ),
                options=tuple(a.id for a in actions),
                option_texts=tuple(f"{a.id}: {a.label}" for a in actions),
                allow_none=not slot.required,
            ),
            True,
        )

    return _build_pointer_slot_question(
        qid, node_name, target, slot, desc_suffix, pointers, data_model
    )


def _format_state_text(
    intent: str,
    tool_name: str,
    pointers: Sequence[PointerSummary],
    actions: Sequence[ActionSpec],
) -> str:
    """Formats explicit `DecisionBatch.state` text for tool pointer binding."""
    lines = [
        f"Intent: {intent.strip()}",
        f"Tool: {tool_name}",
        "Pointers:",
    ]
    for ptr in pointers:
        extra = f", keys={list(ptr.element_keys)}" if ptr.element_keys else ""
        lines.append(
            f"- {ptr.path} ({ptr.value_type}/{ptr.semantic_type.value},"
            f" label={ptr.label}{extra})"
        )
    if actions:
        action_list = ", ".join(f"{a.id} ({a.label})" for a in actions)
        lines.append(f"Actions: {action_list}")
    return "\n".join(lines)


def _build_action_wire_value(action: ActionSpec) -> dict[str, Any]:
    """Serializes an `ActionSpec` into an A2UI v1.0 `Action` event dict."""
    event: dict[str, Any] = {"name": action.id}
    if action.context:
        event["context"] = {k: {"@path": v} for k, v in action.context.items()}
    return {"event": event}


def _decode_literal_primitive(
    target: _TargetSpec,
    slot: ComponentSlot,
    chosen_path: str,
    data_model: Mapping[str, Any],
) -> tuple[bool, Any]:
    """Extracts a validated literal primitive value from `data_model` at `chosen_path`."""
    found, value = _resolve_json_pointer(data_model, chosen_path)
    if not found:
        return False, None
    if slot.value_type == "string":
        return (isinstance(value, str), value)
    if slot.value_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False, None
        if slot.name in target.integer_slots:
            if not _is_integer_value(value):
                return False, None
            return True, int(value)
        return True, value
    return False, None


def _decode_slot_answer(
    target: _TargetSpec,
    slot: ComponentSlot,
    answer: DecisionAnswer | None,
    data_model: Mapping[str, Any],
    action_by_id: Mapping[str, ActionSpec],
) -> tuple[bool, bool, Any]:
    """Decodes one slot answer into `(ok, has_value, bound_value)`."""
    if slot.kind is SlotKind.LITERAL_PRIMITIVE and slot.value_type == "boolean":
        if answer is None:
            return (not slot.required), False, None
        return True, True, bool(answer.yes >= 0.5)

    if answer is None:
        return (not slot.required), False, None

    chosen, prob = answer.top()
    if not chosen or chosen == "none" or prob <= 0.0:
        return (not slot.required), False, None

    if slot.kind is SlotKind.STATIC_ENUM:
        raw_map = target.enum_value_map.get(slot.name)
        val = raw_map.get(chosen, chosen) if raw_map is not None else chosen
        return True, True, val

    if slot.kind is SlotKind.ACTION:
        action = action_by_id.get(chosen)
        if action is None:
            return (not slot.required), False, None
        return True, True, _build_action_wire_value(action)

    if slot.kind is SlotKind.DATA_VALUE:
        return True, True, {"@path": chosen}

    ok, literal_val = _decode_literal_primitive(target, slot, chosen, data_model)
    if not ok:
        return (not slot.required), False, None
    return True, True, literal_val


def _created_surface_id(
    messages: Sequence[AgentToRendererMessage], fallback: str
) -> str:
    """Returns the `surfaceId` of the first `createSurface` message, or `fallback`."""
    for msg in messages:
        dumped = msg.model_dump(by_alias=True, exclude_none=True)
        create_op = dumped.get("createSurface")
        if isinstance(create_op, Mapping) and isinstance(
            create_op.get("surfaceId"), str
        ):
            return str(create_op["surfaceId"])
    return fallback


@experimental
class ToolPointerBinder:
    """Binds structured tool outputs onto Express, `@macro`, or CST surfaces.

    Unifies Express `.a2ui` surfaces, server-side `@macro` definitions, and
    pre-registered Client-Side Templates behind a single decision-model binding
    step and stateless `lower_for_transport` validation.
    """

    def __init__(
        self,
        backend: DecisionBackend,
        *,
        transport_catalogs: Sequence[CatalogApi],
        macros: Sequence[Callable[..., Any]] = (),
        express_surfaces: Sequence[ExpressSurfaceSpec] = (),
        macro_catalog_id: str | None = None,
        component_targets: Sequence[ComponentKey | str] | None = None,
        min_confidence: float = DEFAULT_MIN_CONFIDENCE,
        max_pairs: int = DEFAULT_MAX_PAIRS,
    ) -> None:
        """Initializes a `ToolPointerBinder` and validates registered targets.

        Args:
            backend: Decision backend answering target and slot questions.
            transport_catalogs: Validated v1.0 catalogs accepted by the client
                renderer (including any pre-registered Client-Side Templates).
            macros: Optional `@macro`-decorated Python component definitions.
            express_surfaces: Optional declarative Express `.a2ui` surfaces.
            macro_catalog_id: Optional catalog ID for macro components.
            component_targets: Optional explicit `(catalog_id, name)` keys or
                bare component names to expose as targets. When omitted, all
                active macros and non-basic transport catalog components are
                registered automatically.
            min_confidence: Minimum `select:target` probability required to
                emit a surface (defaults to 0.65).
            max_pairs: Maximum `(question, candidate)` pairs allowed in a
                single backend call before splitting into two calls (defaults
                to 400).

        Raises:
            ValueError: If `transport_catalogs` is empty, `min_confidence` is
                outside `[0.0, 1.0]`, or `max_pairs < 1`.
            A2uiCatalogError: If a registered `@macro` declares unsupported
                `Child`, `ChildList`, `CheckRule`, or nested model parameters,
                or exposes zero bindable `DATA_VALUE` or `ACTION` slots.
        """
        if not transport_catalogs:
            raise ValueError("transport_catalogs must be non-empty.")
        if not (0.0 <= min_confidence <= 1.0):
            raise ValueError(
                f"min_confidence must be in [0.0, 1.0], got {min_confidence}."
            )
        if max_pairs < 1:
            raise ValueError(f"max_pairs must be >= 1, got {max_pairs}.")

        self._backend = backend
        self._transport_catalogs = tuple(transport_catalogs)
        self._macros = tuple(macros)
        self._macro_catalog_id = macro_catalog_id or _DEFAULT_MACRO_CATALOG_ID
        self._min_confidence = min_confidence
        self._max_pairs = max_pairs

        validated_macro_names = [
            _validate_macro_registration(fn) for fn in self._macros
        ]
        self._inference_catalogs = tuple(
            build_inference_catalogs(
                self._transport_catalogs,
                macros=self._macros,
                macro_catalog_id=self._macro_catalog_id,
            )
        )
        self._graph = CatalogDecisionGraph(self._inference_catalogs)
        self._targets = self._build_targets(
            express_surfaces=express_surfaces,
            validated_macro_names=validated_macro_names,
            component_targets=component_targets,
        )
        self._target_by_key: dict[str, _TargetSpec] = {
            t.target_key: t for t in self._targets
        }

    def target_keys(self) -> tuple[str, ...]:
        """Returns the registered target keys in registration order."""
        return tuple(t.target_key for t in self._targets)

    def _build_targets(
        self,
        *,
        express_surfaces: Sequence[ExpressSurfaceSpec],
        validated_macro_names: Sequence[str],
        component_targets: Sequence[ComponentKey | str] | None,
    ) -> tuple[_TargetSpec, ...]:
        """Collects Express, macro, and Client-Side Template targets."""
        targets: list[_TargetSpec] = []
        seen_keys: set[str] = set()

        for spec in express_surfaces:
            tkey = f"express:{spec.id}"
            if tkey in seen_keys:
                raise A2uiCatalogError(f"Duplicate Express surface target '{spec.id}'.")
            seen_keys.add(tkey)
            targets.append(
                _TargetSpec(
                    target_key=tkey,
                    kind="express",
                    description=f"{spec.id}: {spec.description}",
                    express=spec,
                )
            )

        transport_ids = {c.catalog_id for c in self._transport_catalogs}
        for macro_name in validated_macro_names:
            node = self._graph.get_component_by_key(
                (self._macro_catalog_id, macro_name)
            )
            if node is not None:
                _validate_macro_node_slots(self._graph, macro_name, node)

        selected_nodes = self._select_component_nodes(
            validated_macro_names=validated_macro_names,
            component_targets=component_targets,
        )
        for node in selected_nodes:
            is_macro = node.catalog_id not in transport_ids
            target = _make_component_target(self._graph, node, is_macro=is_macro)
            if target.target_key not in seen_keys:
                seen_keys.add(target.target_key)
                targets.append(target)

        return tuple(targets)

    def _resolve_explicit_component_nodes(
        self, component_targets: Sequence[ComponentKey | str]
    ) -> list[ComponentNodeSpec]:
        """Resolves an explicit `component_targets` list from the decision graph."""
        resolved: list[ComponentNodeSpec] = []
        for key in component_targets:
            node = self._graph.get_component(key)
            if node is None:
                raise A2uiCatalogError(f"Unknown component target {key!r}.")
            if not _is_bindable_component(self._graph, node):
                raise A2uiCatalogError(
                    f"Component target '{node.name}' has unsupported slots."
                )
            resolved.append(node)
        return resolved

    def _discover_default_component_nodes(
        self, validated_macro_names: Sequence[str]
    ) -> list[ComponentNodeSpec]:
        """Collects active macros and bindable non-basic transport components."""
        selected: list[ComponentNodeSpec] = []
        for macro_name in validated_macro_names:
            node = self._graph.get_component_by_key(
                (self._macro_catalog_id, macro_name)
            )
            if node is not None:
                selected.append(node)

        for catalog in self._transport_catalogs:
            if _is_basic_catalog(catalog):
                continue
            selected.extend(self._bindable_nodes_in_catalog(catalog))
        return selected

    def _bindable_nodes_in_catalog(
        self, catalog: CatalogApi
    ) -> list[ComponentNodeSpec]:
        """Returns bindable non-container component specs defined in `catalog`."""
        nodes: list[ComponentNodeSpec] = []
        for comp_name in catalog.components:
            node = self._graph.get_component_by_key((catalog.catalog_id, comp_name))
            if node is not None and _is_bindable_component(self._graph, node):
                nodes.append(node)
        return nodes

    def _select_component_nodes(
        self,
        *,
        validated_macro_names: Sequence[str],
        component_targets: Sequence[ComponentKey | str] | None,
    ) -> list[ComponentNodeSpec]:
        """Resolves component specs to expose as binding targets."""
        if component_targets is not None:
            return self._resolve_explicit_component_nodes(component_targets)
        return self._discover_default_component_nodes(validated_macro_names)

    def _collect_component_slot_questions(
        self,
        target: _TargetSpec,
        pointers: Sequence[PointerSummary],
        data_model: Mapping[str, Any],
        actions: Sequence[ActionSpec],
    ) -> list[DecisionQuestion] | None:
        """Builds all slot questions for `target`, or None if a required slot lacks candidates."""
        if target.node is None:
            return None
        questions: list[DecisionQuestion] = []
        for slot in target.node.slots:
            question, ok = _build_slot_question(
                target, slot, pointers, data_model, actions
            )
            if not ok:
                return None
            if question is not None:
                questions.append(question)
        return questions

    def _filter_eligible_targets(
        self,
        pointers: Sequence[PointerSummary],
        data_model: Mapping[str, Any],
        actions: Sequence[ActionSpec],
    ) -> tuple[list[_TargetSpec], dict[str, list[DecisionQuestion]]]:
        """Filters targets whose required paths or slots can be satisfied."""
        pointer_paths = {p.path for p in pointers}
        eligible: list[_TargetSpec] = []
        slot_questions_by_target: dict[str, list[DecisionQuestion]] = {}

        for target in self._targets:
            if target.kind == "express" and target.express is not None:
                if all(path in pointer_paths for path in target.express.required_paths):
                    eligible.append(target)
                    slot_questions_by_target[target.target_key] = []
                continue

            questions = self._collect_component_slot_questions(
                target, pointers, data_model, actions
            )
            if questions is not None:
                eligible.append(target)
                slot_questions_by_target[target.target_key] = questions

        return eligible, slot_questions_by_target

    async def _evaluate_targets(
        self,
        state_text: str,
        eligible: Sequence[_TargetSpec],
        slot_questions_by_target: Mapping[str, list[DecisionQuestion]],
        *,
        timeout_seconds: float | None,
    ) -> tuple[DecisionAnswer, dict[str, DecisionAnswer], int]:
        """Runs 1 batch call when pairs <= `max_pairs`, or splits into 2 calls."""
        select_q = DecisionQuestion(
            id="select:target",
            kind=QuestionKind.CHOICE,
            prompt="Select the best UI target for this tool output, or none.",
            options=tuple(t.target_key for t in eligible),
            option_texts=tuple(t.description for t in eligible),
            allow_none=True,
        )
        all_slot_questions = [
            q for t in eligible for q in slot_questions_by_target[t.target_key]
        ]
        total_pairs = len(select_q.candidates()) + sum(
            len(q.candidates()) for q in all_slot_questions
        )

        if total_pairs <= self._max_pairs:
            batch = DecisionBatch(
                state=state_text, questions=(select_q, *all_slot_questions)
            )
            answers = await self._backend.answer(batch, timeout_seconds=timeout_seconds)
            answer_map = {ans.question_id: ans for ans in answers}
            target_answer = answer_map.get("select:target")
            if target_answer is None:
                raise DecisionBackendError(
                    "Decision backend omitted answer for 'select:target'.",
                    backend_kind=self._backend.backend_kind,
                    model_id=self._backend.model_id,
                )
            return target_answer, answer_map, 1

        # Split into 2 calls when combined pairs exceed max_pairs.
        first_answers = await self._backend.answer(
            DecisionBatch(state=state_text, questions=(select_q,)),
            timeout_seconds=timeout_seconds,
        )
        first_map = {ans.question_id: ans for ans in first_answers}
        target_answer = first_map.get("select:target")
        if target_answer is None:
            raise DecisionBackendError(
                "Decision backend omitted answer for 'select:target'.",
                backend_kind=self._backend.backend_kind,
                model_id=self._backend.model_id,
            )
        choice, prob = target_answer.top()
        if (
            not choice
            or choice == "none"
            or prob < self._min_confidence
            or choice not in slot_questions_by_target
        ):
            return target_answer, {"select:target": target_answer}, 1

        winner_questions = slot_questions_by_target[choice]
        if not winner_questions:
            return target_answer, {"select:target": target_answer}, 1

        second_answers = await self._backend.answer(
            DecisionBatch(state=state_text, questions=tuple(winner_questions)),
            timeout_seconds=timeout_seconds,
        )
        answer_map = {"select:target": target_answer}
        for ans in second_answers:
            answer_map[ans.question_id] = ans
        return target_answer, answer_map, 2

    def _compile_express_messages(
        self,
        spec: ExpressSurfaceSpec,
        data_model: Mapping[str, Any],
        surface_id: str,
    ) -> list[AgentToRendererMessage]:
        """Compiles an Express `.a2ui` target and attaches the tool `data_model`."""
        catalogs: Sequence[CatalogApi] = self._inference_catalogs
        if spec.catalog_id is not None:
            matching = [
                c for c in self._inference_catalogs if c.catalog_id == spec.catalog_id
            ]
            if matching:
                catalogs = matching
        compiler = ExpressCompiler(catalogs)
        compiled = list(compiler.compile(spec.dsl, surface_id=surface_id))
        effective_sid = _created_surface_id(compiled, surface_id)
        data_msg = to_message_models([{
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": effective_sid,
                "path": "/",
                "value": dict(data_model),
            },
        }])
        compiled.extend(data_msg)
        return compiled

    def _build_component_messages(
        self,
        target: _TargetSpec,
        bound_props: Mapping[str, Any],
        data_model: Mapping[str, Any],
        surface_id: str,
    ) -> list[AgentToRendererMessage]:
        """Builds v1.0 wire messages for a bound `@macro` or Client-Side Template."""
        assert target.node is not None
        if target.is_macro:
            surface_cid = self._transport_catalogs[0].catalog_id
            comp_dict: dict[str, Any] = {
                "id": "root",
                "component": target.node.name,
                "@catalogId": target.node.catalog_id,
                **bound_props,
            }
        else:
            surface_cid = target.node.catalog_id
            comp_dict = {
                "id": "root",
                "component": target.node.name,
                **bound_props,
            }
        return list(
            to_message_models([
                {
                    "version": "1.0",
                    "createSurface": {
                        "surfaceId": surface_id,
                        "catalogId": surface_cid,
                    },
                },
                {
                    "version": "1.0",
                    "updateComponents": {
                        "surfaceId": surface_id,
                        "components": [comp_dict],
                    },
                },
                {
                    "version": "1.0",
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": dict(data_model),
                    },
                },
            ])
        )

    def _bind_component_slots(
        self,
        target: _TargetSpec,
        answer_map: Mapping[str, DecisionAnswer],
        data_model: Mapping[str, Any],
        action_by_id: Mapping[str, ActionSpec],
    ) -> tuple[dict[str, Any] | None, str]:
        """Decodes all slot answers for `target`, returning `(bindings, error)`."""
        assert target.node is not None
        bound: dict[str, Any] = {}
        for slot in target.node.slots:
            qid = f"bind:{target.target_key}:{slot.name}"
            ok, has_value, value = _decode_slot_answer(
                target, slot, answer_map.get(qid), data_model, action_by_id
            )
            if not ok:
                return None, f"missing required slot '{slot.name}'"
            if has_value:
                bound[slot.name] = value
        return bound, ""

    async def bind_tool_output(
        self,
        intent: str,
        tool_name: str,
        tool_output: Any,
        *,
        actions: Sequence[ActionSpec | str] = (),
        surface_id: str = "tool_surface",
        exclude: Collection[str] = (),
        mutable_paths: Collection[str] = (),
        labels: Mapping[str, str] | None = None,
        renderer_state: RendererState | None = None,
        timeout_seconds: float | None = None,
    ) -> BindResult:
        """Binds a tool output onto a registered UI surface target.

        Args:
            intent: User intent or task description for the turn.
            tool_name: Name of the tool that produced `tool_output`.
            tool_output: Tool return value (mapping, sequence, or JSON string).
            actions: Optional actions available to bind onto `Action` slots.
            surface_id: Surface ID for the synthesized A2UI surface.
            exclude: Optional JSON Pointer paths to omit from inspection.
            mutable_paths: Optional JSON Pointer paths marked user-editable.
            labels: Optional display label overrides keyed by JSON Pointer.
            renderer_state: Optional `RendererState` passed to
                `lower_for_transport` for stateful validation.
            timeout_seconds: Optional per-call backend deadline in seconds.

        Returns:
            A `BindResult` containing lowered, validated A2UI v1.0 messages or
            an abstention reason.
        """
        data_model = _normalize_tool_output(tool_output)
        if data_model is None:
            return BindResult(abstained=True, reason="empty or non-structured payload")

        pointers = inspect_pointers(
            data_model,
            exclude=exclude,
            mutable_paths=mutable_paths,
            labels=labels,
        )
        if not pointers or all(p.semantic_type is SemanticType.EMPTY for p in pointers):
            return BindResult(abstained=True, reason="empty pointers")

        normalized_actions = _normalize_actions(actions)
        eligible, slot_questions_by_target = self._filter_eligible_targets(
            pointers, data_model, normalized_actions
        )
        if not eligible:
            return BindResult(
                abstained=True, reason="no eligible targets for payload pointers"
            )

        state_text = _format_state_text(intent, tool_name, pointers, normalized_actions)
        target_answer, answer_map, calls = await self._evaluate_targets(
            state_text,
            eligible,
            slot_questions_by_target,
            timeout_seconds=timeout_seconds,
        )
        choice, prob = target_answer.top()
        if not choice or choice == "none":
            return BindResult(
                abstained=True,
                reason="target selection chose none",
                confidence=prob,
                decision_calls=calls,
            )
        if prob < self._min_confidence:
            return BindResult(
                abstained=True,
                reason=(
                    f"target confidence {prob:.3f} below min_confidence"
                    f" {self._min_confidence:.3f}"
                ),
                target_id=choice,
                confidence=prob,
                decision_calls=calls,
            )

        target = self._target_by_key.get(choice)
        if target is None:
            return BindResult(
                abstained=True,
                reason=f"unknown target choice '{choice}'",
                confidence=prob,
                decision_calls=calls,
            )

        safe_data_model = _redact_data_model(
            data_model, exclude=exclude, mutable_paths=mutable_paths
        )
        return self._finalize_target(
            target,
            answer_map=answer_map,
            data_model=safe_data_model,
            actions=normalized_actions,
            surface_id=surface_id,
            confidence=prob,
            decision_calls=calls,
            renderer_state=renderer_state,
        )

    def _finalize_target(
        self,
        target: _TargetSpec,
        *,
        answer_map: Mapping[str, DecisionAnswer],
        data_model: Mapping[str, Any],
        actions: Sequence[ActionSpec],
        surface_id: str,
        confidence: float,
        decision_calls: int,
        renderer_state: RendererState | None,
    ) -> BindResult:
        """Assembles, lowers, and validates messages for the winning target."""
        bound_props: dict[str, Any] = {}
        if target.kind == "express" and target.express is not None:
            raw_messages = self._compile_express_messages(
                target.express, data_model, surface_id
            )
        else:
            action_by_id = {a.id: a for a in actions}
            decoded, err = self._bind_component_slots(
                target, answer_map, data_model, action_by_id
            )
            if decoded is None:
                return BindResult(
                    abstained=True,
                    reason=err,
                    target_id=target.target_key,
                    confidence=confidence,
                    decision_calls=decision_calls,
                )
            bound_props = decoded
            raw_messages = self._build_component_messages(
                target, bound_props, data_model, surface_id
            )

        lowered = lower_for_transport(
            raw_messages,
            transport_catalogs=self._transport_catalogs,
            macros=self._macros,
            macro_catalog_id=self._macro_catalog_id,
            renderer_state=renderer_state,
        )
        return BindResult(
            messages=lowered,
            abstained=False,
            reason="",
            target_id=target.target_key,
            confidence=confidence,
            bindings=bound_props,
            decision_calls=decision_calls,
        )
