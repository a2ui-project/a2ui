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

"""Deterministic validator for `patterns.json`, `templates.json`, and sample payloads."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import copy
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Literal

from a2ui.core import A2uiError
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    BlockSpec,
    CatalogDecisionGraph,
    CatalogPattern,
    PatternError,
    PatternExpander,
    PatternLibrary,
    PatternRef,
    SurfaceTemplate,
    TemplateRegistry,
    eligible_archetypes,
    inspect_payload_pointers,
    lint_components,
    resolve_fallback_pattern,
)
from a2ui.parser.messages import to_message_models
from a2ui.utils import validate_payload

from _common import (
    LoadedCatalog,
    ToolError,
    load_pattern_library,
    load_sample_payloads,
    load_template_registry,
    render_markdown_table,
)
from synthetic_bindings import (
    knob_combinations,
    synthetic_block_bindings,
    synthetic_instances,
    synthetic_page_bindings,
    synthetic_payload,
)

_CRITERIA_PATTERN_RE = re.compile(r"\bpattern:([a-z_]+)(?::([A-Za-z0-9_]+))?\b")
_REQUIRED_PROP_RE = re.compile(r"'([^']+)' is a required property")
_ADDITIONAL_PROP_RE = re.compile(r"Additional properties are not allowed \('([^']+)'")
_NON_ACTION_EVENT_SLOTS: frozenset[str] = frozenset({
    "label",
    "sendLabel",
    "title",
    "headline",
    "subtitle",
    "text",
    "body",
    "caption",
    "supporting",
    "detail",
    "value",
    "picture",
    "icon",
})


@dataclass(frozen=True)
class ExpansionFailure:
    """Records one failure while expanding, linting, or schema-checking a pattern.

    Attributes:
        pattern: Pattern name in `patterns.json` (or `"<payload>"` for payload checks).
        block_id: Grammar block identifier being dry-run, or `None` for `"page"`.
        knobs: Anatomy knob assignment active when the failure occurred.
        stage: Validation stage where the failure occurred (`"expand"`, `"lint"`,
            `"schema"`, or `"payload"`).
        message: Actionable diagnostic citing file, pattern, component, property, and guide anchor.
    """

    pattern: str
    block_id: str | None
    knobs: Mapping[str, str]
    stage: Literal["expand", "lint", "schema", "payload"]
    message: str


@dataclass(frozen=True)
class TemplateValidationFailure:
    """Records one failure while linting, matching, or rendering a `SurfaceTemplate`.

    Attributes:
        template_id: Identifier of the failing template in `templates.json`.
        sample: Sample payload name that triggered the failure, or `None` for static checks.
        stage: Validation stage where the failure occurred (`"lint"`, `"schema"`, or `"payload"`).
        message: Diagnostic describing the lint, payload, or schema failure.
    """

    template_id: str
    sample: str | None
    stage: Literal["lint", "schema", "payload"]
    message: str


@dataclass(frozen=True)
class BlockCoverage:
    """Describes how one layout grammar block resolves against a `PatternLibrary`.

    Attributes:
        block_id: Grammar block identifier.
        resolution: Resolution mode (`"direct"`, `"fallback"`, or `"unavailable"`).
        pattern: Resolved pattern name in `patterns.json`, or `None` if unavailable.
        via: Fallback pattern reference (including optional `:variant`), or `None` if direct.
    """

    block_id: str
    resolution: Literal["direct", "fallback", "unavailable"]
    pattern: str | None
    via: str | None


@dataclass(frozen=True)
class ArchetypeCoverage:
    """Summarizes pattern-level coverage for one layout archetype.

    Attributes:
        archetype_id: Archetype identifier from `archetypes.json`.
        family: High-level task family owning the archetype.
        eligible: Whether the archetype can be synthesized from the pattern library.
        missing_required: Required block IDs (`!`) that cannot be resolved at all.
        degraded_required: Required block IDs (`!`) that resolved only via a fallback pattern.
        missing_criteria_patterns: `pattern:<name>:<variant>` criteria missing from the library.
        viable_blocks: Count of optional or required blocks in the archetype that resolve.
        at_least: Minimum viable block count required by the archetype grammar.
    """

    archetype_id: str
    family: str
    eligible: bool
    missing_required: tuple[str, ...]
    degraded_required: tuple[str, ...]
    missing_criteria_patterns: tuple[str, ...]
    viable_blocks: int
    at_least: int


@dataclass(frozen=True)
class PayloadSampleReport:
    """Records per-sample archetype eligibility and template matching results.

    Attributes:
        sample_name: Key identifying the sample payload in `--payload`.
        pointer_count: Number of JSON Pointers discovered by `inspect_payload_pointers`.
        eligible_archetypes: Archetype IDs eligible for the sample payload and pattern library.
        matching_templates: Surface template IDs whose `requiredPointers` match the sample.
    """

    sample_name: str
    pointer_count: int
    eligible_archetypes: tuple[str, ...]
    matching_templates: tuple[str, ...]


@dataclass(frozen=True)
class ValidationReport:
    """Holds the complete validation report across `patterns.json`, `templates.json`, and `--payload`.

    Attributes:
        catalog_id: Canonical catalog URI from `catalog.json`.
        patterns_path: Resolved path to `patterns.json`, or `None` for fixed-surface catalogs.
        templates_path: Resolved path to `templates.json`, or `None` for composable catalogs.
        payload_path: Resolved path to the sample payloads JSON file.
        schema_ok: Whether top-level sidecar schema validation succeeded.
        schema_error: Top-level schema validation error string, if any.
        unknown_patterns: Pattern names in `patterns.json` not referenced by `page` or any block.
        warnings: Non-fatal warnings for unreachable pattern variants or truncated knob products.
        expansions_run: Total number of pattern variant and knob dry-run expansions executed.
        failures: Pattern expansion, lint, schema, or payload eligibility failures.
        templates_validated: Number of surface templates validated from `templates.json`.
        template_failures: Surface template lint, payload matching, or schema failures.
        blocks: Resolution status for all 19 layout grammar blocks.
        archetypes: Pattern-level eligibility breakdown for all 14 layout archetypes.
        payload_samples: Per-sample pointer, archetype eligibility, and template match reports.
        payload_eligible: Union of archetype IDs eligible across all sample payloads.
    """

    catalog_id: str
    patterns_path: Path | None
    templates_path: Path | None
    payload_path: Path
    schema_ok: bool
    schema_error: str | None
    unknown_patterns: tuple[str, ...]
    warnings: tuple[str, ...]
    expansions_run: int
    failures: tuple[ExpansionFailure, ...]
    templates_validated: int
    template_failures: tuple[TemplateValidationFailure, ...]
    blocks: tuple[BlockCoverage, ...]
    archetypes: tuple[ArchetypeCoverage, ...]
    payload_samples: tuple[PayloadSampleReport, ...]
    payload_eligible: tuple[str, ...]

    @property
    def ok(self) -> bool:
        """Returns whether all schema, pattern, template, and payload checks passed.

        Returns:
            Whether `schema_ok` is true and both `failures` and `template_failures` are empty.
        """
        return self.schema_ok and not self.failures and not self.template_failures


def _wire_version(protocol_version: str) -> str:
    """Normalizes `protocol_version` to its wire envelope version string.

    Args:
        protocol_version: Protocol version string from `CatalogDecisionGraph`.

    Returns:
        `'1.0'` for 1.x protocol versions, or `'v0.9'` otherwise.
    """
    clean = protocol_version.strip().lstrip("v")
    return "1.0" if clean == "1" or clean.startswith("1.") else "v0.9"


def surface_messages(
    graph: CatalogDecisionGraph,
    components: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    *,
    ensure_root: bool = False,
) -> list[dict[str, Any]]:
    """Builds a wire-format `createSurface`, `updateComponents`, and `updateDataModel` batch.

    Args:
        graph: Catalog decision graph providing protocol version and catalog URI.
        components: Expanded component dictionaries to place in `updateComponents`.
        payload: Synthetic or sample data model dictionary for `updateDataModel`.
        ensure_root: Whether to rewrite the first component ID to `"root"` when testing
            a standalone block outside a `"page"` wrapper.

    Returns:
        A list of A2UI wire message dictionaries ready for `to_message_models`.
    """
    version = _wire_version(graph.protocol_version)
    create_body: dict[str, Any] = {"surfaceId": "validation_surface"}
    if graph.surface_catalog_id is not None:
        create_body["catalogId"] = graph.surface_catalog_id
    copied = [copy.deepcopy(dict(c)) for c in components]
    # Standalone block dry runs lack a page wrapper, so promote the first root to "root".
    if ensure_root and copied and not any(c.get("id") == "root" for c in copied):
        copied[0]["id"] = "root"
    messages: list[dict[str, Any]] = [
        {"version": version, "createSurface": create_body},
        {
            "version": version,
            "updateComponents": {
                "surfaceId": "validation_surface",
                "components": copied,
            },
        },
    ]
    if payload:
        messages.append({
            "version": version,
            "updateDataModel": {
                "surfaceId": "validation_surface",
                "path": "/",
                "value": dict(payload),
            },
        })
    return messages


def _first_line(exc: Exception) -> str:
    """Returns the first non-empty line of an exception message.

    Args:
        exc: Exception instance to summarize.

    Returns:
        The first non-empty line of `str(exc)`, or the exception class name.
    """
    for line in str(exc).splitlines():
        if line.strip():
            return line.strip()
    return type(exc).__name__


def _format_failure_message(
    *,
    file_path: Path | None,
    pattern: str,
    component_id: str,
    component_type: str | None = None,
    prop: str,
    rule: str,
    anchor: str,
) -> str:
    """Formats a failure diagnostic naming file, pattern, component, property, rule, and guide link.

    Args:
        file_path: Path to the offending artifact file, or `None` for default `"patterns.json"`.
        pattern: Pattern name in `patterns.json`.
        component_id: Template component ID within the pattern.
        component_type: Optional catalog component type name.
        prop: Component property path where validation failed.
        rule: Concise description of the violated rule.
        anchor: Section anchor in `patterns_authoring_guide.md`.

    Returns:
        The formatted diagnostic message string.
    """
    file_label = file_path.name if file_path is not None else "patterns.json"
    comp_desc = (
        f"component '{component_id}' ({component_type})"
        if component_type
        else f"component '{component_id}'"
    )
    return (
        f"{file_label}: pattern '{pattern}', {comp_desc}, property '{prop}':"
        f" {rule} (see patterns_authoring_guide.md#{anchor})"
    )


def _infer_prop_from_message(msg: str) -> str:
    """Infers a component property name from a JSON Schema validation error line.

    Args:
        msg: First line of a schema validation error message.

    Returns:
        The missing required or unexpected property name, or `"component"` as fallback.
    """
    req_match = _REQUIRED_PROP_RE.search(msg)
    if req_match is not None:
        return req_match.group(1)
    add_match = _ADDITIONAL_PROP_RE.search(msg)
    if add_match is not None:
        return add_match.group(1)
    return "component"


def _resolve_template_component(
    expanded_id: str,
    comp_type: str | None,
    cat_pattern: CatalogPattern | None,
    block_id: str | None,
    knobs: Mapping[str, str],
) -> tuple[str, str | None]:
    """Maps an expanded component ID back to its template ID and type in `patterns.json`.

    Args:
        expanded_id: Component ID emitted by `PatternExpander` (or `"root"`).
        comp_type: Component type name from the expanded component, if known.
        cat_pattern: Source `CatalogPattern` definition, if available.
        block_id: Grammar block prefix applied during expansion, or `None` for `"page"`.
        knobs: Active knob mapping used to select the pattern variant.

    Returns:
        A `(template_component_id, component_type)` pair pointing to the authored template.
    """
    if cat_pattern is None:
        return (expanded_id, comp_type)
    variant = cat_pattern.select_variant(knobs)
    root_aliases = {variant.root, "root"}
    if block_id is not None:
        root_aliases.add(f"{block_id}_root")
    for tpl in variant.components:
        tpl_id = str(tpl.get("id", ""))
        tpl_type = str(tpl.get("component", "")) or comp_type
        if tpl_id == variant.root and expanded_id in root_aliases:
            return (tpl_id, tpl_type)
        if block_id is not None and (
            expanded_id == f"{block_id}_{tpl_id}"
            or expanded_id.startswith(f"{block_id}_{tpl_id}_")
        ):
            return (tpl_id, tpl_type)
        if expanded_id == tpl_id or expanded_id.startswith(f"{tpl_id}_"):
            return (tpl_id, tpl_type)
    return (expanded_id, comp_type)


def _extract_schema_failure_target(
    exc: Exception,
    components: Sequence[Mapping[str, Any]],
    cat_pattern: CatalogPattern | None,
    block_id: str | None,
    knobs: Mapping[str, str],
) -> tuple[str, str | None, str]:
    """Extracts `(template_component_id, component_type, property_name)` from a schema error.

    Args:
        exc: Validation exception raised by `to_message_models` or `validate_payload`.
        components: Expanded component list that was validated.
        cat_pattern: Source `CatalogPattern` definition.
        block_id: Grammar block ID, or `None` for `"page"`.
        knobs: Active knob values for variant resolution.

    Returns:
        A `(template_component_id, component_type, property_name)` tuple.
    """
    msg = _first_line(exc)
    exc_path = getattr(exc, "path", None)
    expanded_id = (
        cat_pattern.select_variant(knobs).root if cat_pattern is not None else "<root>"
    )
    comp_type: str | None = None
    prop = _infer_prop_from_message(msg)

    if isinstance(exc_path, str) and exc_path.startswith("/components/"):
        parts = exc_path.strip("/").split("/")
        if len(parts) >= 2 and parts[1].isdigit():
            idx = int(parts[1])
            if 0 <= idx < len(components):
                comp = components[idx]
                expanded_id = str(comp.get("id", expanded_id))
                comp_type = str(comp.get("component", "")) or None
        if len(parts) >= 3:
            prop = ".".join(parts[2:])

    tpl_id, tpl_type = _resolve_template_component(
        expanded_id, comp_type, cat_pattern, block_id, knobs
    )
    return (tpl_id, tpl_type, prop)


def _is_valid_event_target(target: Any) -> bool:
    """Returns whether `target` is a valid `$event` action slot binding.

    Args:
        target: Value assigned to the `"$event"` key in a component template.

    Returns:
        Whether `target` names an action slot rather than a presentational label slot.
    """
    if isinstance(target, str):
        return bool(target.strip()) and target not in _NON_ACTION_EVENT_SLOTS
    if isinstance(target, Mapping):
        action_slot = target.get("$action")
        return (
            len(target) == 1
            and isinstance(action_slot, str)
            and bool(action_slot.strip())
            and action_slot not in _NON_ACTION_EVENT_SLOTS
        )
    return False


def _check_event_context(ctx_val: Any, *, ctx_prop: str) -> tuple[str, str] | None:
    """Validates the `context` sub-object of an `$event` directive.

    Args:
        ctx_val: Value of the `"context"` property inside an `"$event"` directive.
        ctx_prop: Dotted property path to `"context"` for diagnostic messages.

    Returns:
        A `(property_path, rule_message)` tuple if invalid, or `None` if valid.
    """
    if ctx_val is None:
        return None
    if not isinstance(ctx_val, Mapping):
        return (
            ctx_prop,
            "$event 'context' must be an object or {'$actionContext': True}",
        )
    if "$actionContext" in ctx_val and dict(ctx_val) != {"$actionContext": True}:
        return (
            ctx_prop,
            (
                "$actionContext must be {'$actionContext': True} as"
                " the entire 'context' mapping"
            ),
        )
    if any(v == "$item" for v in ctx_val.values()):
        return (
            ctx_prop,
            (
                "legacy '$item' context shorthand is not supported;"
                " use {'$actionContext': True}"
            ),
        )
    return None


def _check_event_mapping(
    node: Mapping[str, Any], *, prop_path: str
) -> tuple[str, str] | None:
    """Validates an `$event` or `$actionContext` directive mapping.

    Args:
        node: Mapping inside a component property value.
        prop_path: Dotted property path to `node`.

    Returns:
        A `(property_path, rule_message)` tuple if invalid, or `None` if valid.
    """
    if "$event" in node:
        target = node["$event"]
        if not _is_valid_event_target(target):
            return (
                prop_path,
                (
                    "$event must bind an action slot ('action' or"
                    f" {{'$action': 'action'}}) rather than {target!r}"
                ),
            )
        if "context" in node:
            return _check_event_context(
                node["context"], ctx_prop=f"{prop_path}.context"
            )
        return None
    if "$actionContext" in node:
        return (
            prop_path,
            (
                "$actionContext is only valid as 'context':"
                " {'$actionContext': True} inside an $event directive"
            ),
        )
    return None


def _walk_property_directives(value: Any, *, prop_path: str) -> list[tuple[str, str]]:
    """Recursively checks a component property value for invalid `$event` or `$actionContext` directives.

    Args:
        value: Arbitrary JSON value inside a component template property.
        prop_path: Dotted property path to `value`.

    Returns:
        List of `(property_path, rule_message)` findings discovered under `value`.
    """
    if isinstance(value, Mapping):
        finding = _check_event_mapping(value, prop_path=prop_path)
        if finding is not None:
            return [finding]
        if "$event" in value:
            return []
        out: list[tuple[str, str]] = []
        for k, v in value.items():
            out.extend(_walk_property_directives(v, prop_path=f"{prop_path}.{k}"))
        return out
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        out = []
        for item in value:
            out.extend(_walk_property_directives(item, prop_path=prop_path))
        return out
    return []


def _validate_component_template_directives(
    comp_tpl: Mapping[str, Any],
    *,
    pattern_name: str,
    block_id: str | None,
    knobs: Mapping[str, str],
    patterns_path: Path | None,
    default_id: str,
) -> list[ExpansionFailure]:
    """Validates `$event` and `$actionContext` directives on one component template dict.

    Args:
        comp_tpl: Raw component template mapping from `patterns.json`.
        pattern_name: Owning pattern name.
        block_id: Grammar block ID, or `None` for `"page"`.
        knobs: Knob assignment for the containing pattern variant.
        patterns_path: Path to `patterns.json` for diagnostic formatting.
        default_id: Fallback component ID when `comp_tpl` omits `"id"`.

    Returns:
        List of `ExpansionFailure` entries found on `comp_tpl`.
    """
    comp_id = str(comp_tpl.get("id", default_id))
    comp_type = str(comp_tpl.get("component", "")) or None
    failures: list[ExpansionFailure] = []
    for prop_name, prop_val in comp_tpl.items():
        if prop_name in ("id", "component"):
            continue
        for failed_prop, rule in _walk_property_directives(
            prop_val, prop_path=prop_name
        ):
            failures.append(
                ExpansionFailure(
                    pattern=pattern_name,
                    block_id=block_id,
                    knobs=dict(knobs),
                    stage="lint",
                    message=_format_failure_message(
                        file_path=patterns_path,
                        pattern=pattern_name,
                        component_id=comp_id,
                        component_type=comp_type,
                        prop=failed_prop,
                        rule=rule,
                        anchor="action-events-and-action-context",
                    ),
                )
            )
    return failures


def _validate_pattern_directives(
    cat_pattern: CatalogPattern,
    *,
    block_id: str | None,
    patterns_path: Path | None,
) -> list[ExpansionFailure]:
    """Validates `$event` and `$actionContext` directives across all variants and fieldVariants.

    Args:
        cat_pattern: Catalog pattern definition to inspect.
        block_id: Grammar block ID, or `None` for `"page"`.
        patterns_path: Path to `patterns.json` for diagnostic formatting.

    Returns:
        List of `ExpansionFailure` entries across all variants and `fieldVariants`.
    """
    failures: list[ExpansionFailure] = []
    for variant in cat_pattern.variants:
        variant_knobs = {k: v[0] for k, v in variant.when.items() if v}
        for comp_tpl in variant.components:
            failures.extend(
                _validate_component_template_directives(
                    comp_tpl,
                    pattern_name=cat_pattern.name,
                    block_id=block_id,
                    knobs=variant_knobs,
                    patterns_path=patterns_path,
                    default_id=variant.root,
                )
            )
    for fv_name, fv_tpl in cat_pattern.field_variants.items():
        failures.extend(
            _validate_component_template_directives(
                fv_tpl,
                pattern_name=cat_pattern.name,
                block_id=block_id,
                knobs={},
                patterns_path=patterns_path,
                default_id=f"fieldVariants.{fv_name}",
            )
        )
    return failures


def _check_expanded_surface(
    pattern_name: str,
    block_id: str | None,
    knobs: Mapping[str, str],
    components: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    graph: CatalogDecisionGraph,
    *,
    cat_pattern: CatalogPattern | None = None,
    patterns_path: Path | None = None,
) -> list[ExpansionFailure]:
    """Runs `lint_components` and `validate_payload` on an expanded component list.

    Args:
        pattern_name: Name of the expanded pattern.
        block_id: Grammar block ID, or `None` for `"page"`.
        knobs: Active knob mapping used for expansion.
        components: Expanded component dictionaries.
        payload: Synthetic data model dictionary for `updateDataModel`.
        graph: Catalog decision graph used for wire message validation.
        cat_pattern: Source `CatalogPattern` for mapping expanded IDs back to templates.
        patterns_path: Path to `patterns.json` for diagnostic formatting.

    Returns:
        List of lint and catalog schema `ExpansionFailure` records.
    """
    failures: list[ExpansionFailure] = []
    default_root = (
        cat_pattern.select_variant(knobs).root if cat_pattern is not None else "<root>"
    )
    for finding in lint_components(components, plan=None):
        if finding.severity == "error":
            tpl_id, tpl_type = _resolve_template_component(
                finding.component_id or default_root,
                None,
                cat_pattern,
                block_id,
                knobs,
            )
            failures.append(
                ExpansionFailure(
                    pattern=pattern_name,
                    block_id=block_id,
                    knobs=dict(knobs),
                    stage="lint",
                    message=_format_failure_message(
                        file_path=patterns_path,
                        pattern=pattern_name,
                        component_id=tpl_id,
                        component_type=tpl_type,
                        prop="children",
                        rule=f"{finding.code}: {finding.message}",
                        anchor="container-topology-and-lint-rules",
                    ),
                )
            )
    try:
        raw_msgs = surface_messages(
            graph, components, payload, ensure_root=block_id is not None
        )
        models = to_message_models(raw_msgs)
        validate_payload(graph.catalogs, models)
    except (A2uiError, ValueError, TypeError) as exc:
        tpl_id, tpl_type, prop = _extract_schema_failure_target(
            exc, components, cat_pattern, block_id, knobs
        )
        failures.append(
            ExpansionFailure(
                pattern=pattern_name,
                block_id=block_id,
                knobs=dict(knobs),
                stage="schema",
                message=_format_failure_message(
                    file_path=patterns_path,
                    pattern=pattern_name,
                    component_id=tpl_id,
                    component_type=tpl_type,
                    prop=prop,
                    rule=_first_line(exc),
                    anchor="component-schema-and-required-properties",
                ),
            )
        )
    return failures


def _check_unreachable_variants(
    pattern: CatalogPattern, combos: Sequence[Mapping[str, str]]
) -> list[str]:
    """Warns when a declared variant with `when` is never selected by any knob combination.

    Args:
        pattern: Catalog pattern definition whose variants are checked.
        combos: Enumerated knob combinations for `pattern`.

    Returns:
        List of warning strings for any unreachable pattern variants.
    """
    if len(pattern.variants) <= 1:
        return []
    selected_ids = {id(pattern.select_variant(knobs)) for knobs in combos}
    warnings: list[str] = []
    for idx, variant in enumerate(pattern.variants):
        if id(variant) not in selected_ids:
            warnings.append(
                f"Pattern '{pattern.name}' variant #{idx} (when={dict(variant.when)})"
                " is never selected by any declared knob combination."
            )
    return warnings


def dry_run_block(
    expander: PatternExpander,
    library: PatternLibrary,
    block: BlockSpec,
    graph: CatalogDecisionGraph,
    *,
    patterns_path: Path | None = None,
) -> tuple[int, list[ExpansionFailure], list[str]]:
    """Dry-runs `block` across all knob combinations of its resolved pattern.

    Args:
        expander: Pattern expander bound to `library` and `graph`.
        library: Pattern library under validation.
        block: Layout grammar block specification to expand.
        graph: Catalog decision graph for component schema verification.
        patterns_path: Optional path to `patterns.json` for diagnostic messages.

    Returns:
        A `(runs, failures, warnings)` tuple for `block`.
    """
    resolved = resolve_fallback_pattern(block, library)
    if resolved is None:
        return (0, [], [])
    cat_pattern = library.get(resolved.pattern)
    if cat_pattern is None:
        return (0, [], [])

    combos, truncated = knob_combinations(cat_pattern)
    warnings = _check_unreachable_variants(cat_pattern, combos)
    if truncated:
        warnings.append(
            f"Pattern '{cat_pattern.name}' knob combinations truncated at"
            f" {len(combos)}."
        )

    bindings = synthetic_block_bindings(block)
    instances = synthetic_instances(block, bindings)
    payload = synthetic_payload(block)
    failures: list[ExpansionFailure] = _validate_pattern_directives(
        cat_pattern, block_id=block.id, patterns_path=patterns_path
    )
    runs = 0

    for knobs in combos:
        merged_knobs = {**knobs, **resolved.knobs}
        runs += 1
        try:
            expansion = expander.expand_block(
                block.id,
                block.pattern,
                bindings,
                merged_knobs,
                instances,
                block.id,
            )
            expanded = expansion.components
        except (PatternError, A2uiError, KeyError, ValueError) as exc:
            variant_root = cat_pattern.select_variant(merged_knobs).root
            failures.append(
                ExpansionFailure(
                    pattern=cat_pattern.name,
                    block_id=block.id,
                    knobs=merged_knobs,
                    stage="expand",
                    message=_format_failure_message(
                        file_path=patterns_path,
                        pattern=cat_pattern.name,
                        component_id=variant_root,
                        prop="root",
                        rule=_first_line(exc),
                        anchor="pattern-expansion-directives",
                    ),
                )
            )
            continue
        failures.extend(
            _check_expanded_surface(
                cat_pattern.name,
                block.id,
                merged_knobs,
                expanded,
                payload,
                graph,
                cat_pattern=cat_pattern,
                patterns_path=patterns_path,
            )
        )
    return (runs, failures, warnings)


def _expand_seed_block_for_page(
    expander: PatternExpander,
    grammar: ArchetypeGrammar,
    library: PatternLibrary,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    """Expands one real block so `expand_page` has a valid child component root ID.

    Args:
        expander: Pattern expander bound to `library`.
        grammar: Layout archetype grammar providing candidate seed blocks.
        library: Pattern library under validation.

    Returns:
        A `(seed_components, block_root_ids, synthetic_payload)` tuple.
    """
    preferred_order = ("prose", *grammar.blocks.keys())
    for block_id in preferred_order:
        block = grammar.blocks.get(block_id)
        if block is None or resolve_fallback_pattern(block, library) is None:
            continue
        bindings = synthetic_block_bindings(block)
        instances = synthetic_instances(block, bindings)
        try:
            expansion = expander.expand_block(
                block.id, block.pattern, bindings, {}, instances, block.id
            )
            comps = expansion.components
            if comps:
                return (
                    comps,
                    [str(comps[0]["id"])],
                    synthetic_payload(block),
                )
        except (PatternError, A2uiError, KeyError, ValueError):
            continue
    return ([], [], synthetic_payload(grammar.blocks["prose"]))


def dry_run_page(
    expander: PatternExpander,
    grammar: ArchetypeGrammar,
    library: PatternLibrary,
    graph: CatalogDecisionGraph,
    *,
    patterns_path: Path | None = None,
) -> tuple[int, list[ExpansionFailure], list[str]]:
    """Dry-runs the `page` pattern paired with one expanded seed block.

    Args:
        expander: Pattern expander bound to `library` and `graph`.
        grammar: Layout archetype grammar.
        library: Pattern library under validation.
        graph: Catalog decision graph for schema validation.
        patterns_path: Optional path to `patterns.json` for diagnostic messages.

    Returns:
        A `(runs, failures, warnings)` tuple for the `"page"` pattern.
    """
    page_pattern = library.get("page")
    if page_pattern is None:
        return (
            0,
            [
                ExpansionFailure(
                    pattern="page",
                    block_id=None,
                    knobs={},
                    stage="expand",
                    message=_format_failure_message(
                        file_path=patterns_path,
                        pattern="page",
                        component_id="<root>",
                        prop="patterns.page",
                        rule="Pattern 'page' is required in patterns.json.",
                        anchor="top-level-file-structure",
                    ),
                )
            ],
            [],
        )

    seed_comps, block_roots, payload = _expand_seed_block_for_page(
        expander, grammar, library
    )
    combos, truncated = knob_combinations(page_pattern)
    warnings = _check_unreachable_variants(page_pattern, combos)
    if truncated:
        warnings.append(f"Pattern 'page' knob combinations truncated at {len(combos)}.")

    page_bindings = synthetic_page_bindings()
    failures: list[ExpansionFailure] = _validate_pattern_directives(
        page_pattern, block_id=None, patterns_path=patterns_path
    )
    runs = 0
    for knobs in combos:
        runs += 1
        try:
            page_expansion = expander.expand_page(
                page_bindings, block_roots=block_roots, knobs=knobs
            )
            page_comps = page_expansion.components
        except (PatternError, A2uiError, KeyError, ValueError) as exc:
            variant_root = page_pattern.select_variant(knobs).root
            failures.append(
                ExpansionFailure(
                    pattern="page",
                    block_id=None,
                    knobs=dict(knobs),
                    stage="expand",
                    message=_format_failure_message(
                        file_path=patterns_path,
                        pattern="page",
                        component_id=variant_root,
                        prop="root",
                        rule=_first_line(exc),
                        anchor="pattern-expansion-directives",
                    ),
                )
            )
            continue
        combined = [*page_comps, *seed_comps]
        failures.extend(
            _check_expanded_surface(
                "page",
                None,
                knobs,
                combined,
                payload,
                graph,
                cat_pattern=page_pattern,
                patterns_path=patterns_path,
            )
        )
    return (runs, failures, warnings)


def block_coverage(
    grammar: ArchetypeGrammar, library: PatternLibrary
) -> tuple[BlockCoverage, ...]:
    """Computes direct, fallback, or unavailable resolution for every grammar block.

    Args:
        grammar: Layout archetype grammar defining all 19 blocks.
        library: Pattern library under evaluation.

    Returns:
        A tuple of `BlockCoverage` entries in grammar block order.
    """
    out: list[BlockCoverage] = []
    for block in grammar.blocks.values():
        primary_name = PatternRef.parse(block.pattern).name
        if library.has_pattern(primary_name):
            out.append(
                BlockCoverage(
                    block_id=block.id,
                    resolution="direct",
                    pattern=primary_name,
                    via=None,
                )
            )
            continue
        resolved = resolve_fallback_pattern(block, library)
        if resolved is not None:
            via = resolved.pattern
            if "layout" in resolved.knobs:
                via = f"{resolved.pattern}:{resolved.knobs['layout']}"
            out.append(
                BlockCoverage(
                    block_id=block.id,
                    resolution="fallback",
                    pattern=resolved.pattern,
                    via=via,
                )
            )
        else:
            out.append(
                BlockCoverage(
                    block_id=block.id,
                    resolution="unavailable",
                    pattern=None,
                    via=None,
                )
            )
    return tuple(out)


def _missing_criteria_patterns(
    criteria: str, library: PatternLibrary
) -> tuple[str, ...]:
    """Returns `pattern:<name>:<variant>` tokens in `criteria` missing from `library`.

    Args:
        criteria: Archetype criteria expression string.
        library: Pattern library under evaluation.

    Returns:
        Tuple of missing pattern or `pattern:variant` specifiers.
    """
    missing: list[str] = []
    for match in _CRITERIA_PATTERN_RE.finditer(criteria):
        pat_name, pat_var = match.group(1), match.group(2)
        if not library.has_pattern(pat_name, pat_var):
            missing.append(f"{pat_name}:{pat_var}" if pat_var else pat_name)
    return tuple(missing)


def _single_archetype_coverage(
    arch: Any,
    library: PatternLibrary,
    by_block: Mapping[str, BlockCoverage],
    *,
    has_page: bool,
) -> ArchetypeCoverage:
    """Computes pattern-level coverage for one `LayoutArchetype`.

    Args:
        arch: Layout archetype specification from `grammar.archetypes`.
        library: Pattern library under evaluation.
        by_block: Block coverage lookup keyed by `block_id`.
        has_page: Whether `library` defines the required `"page"` pattern.

    Returns:
        An `ArchetypeCoverage` record for `arch`.
    """
    missing_req: list[str] = []
    degraded_req: list[str] = []
    for req_id in arch.required_block_ids():
        cov = by_block.get(req_id)
        if cov is None or cov.resolution == "unavailable":
            missing_req.append(req_id)
        elif cov.resolution == "fallback":
            degraded_req.append(req_id)

    missing_crit = _missing_criteria_patterns(arch.criteria, library)
    viable = sum(
        1
        for ref in arch.blocks
        if by_block.get(ref.id) is not None
        and by_block[ref.id].resolution != "unavailable"
    )
    eligible = (
        has_page and not missing_req and not missing_crit and viable >= arch.at_least
    )
    return ArchetypeCoverage(
        archetype_id=arch.id,
        family=arch.family,
        eligible=eligible,
        missing_required=tuple(missing_req),
        degraded_required=tuple(degraded_req),
        missing_criteria_patterns=missing_crit,
        viable_blocks=viable,
        at_least=arch.at_least,
    )


def archetype_coverage(
    grammar: ArchetypeGrammar,
    library: PatternLibrary,
    blocks: Sequence[BlockCoverage],
) -> tuple[ArchetypeCoverage, ...]:
    """Computes pattern-level eligibility for all 14 archetypes.

    Args:
        grammar: Layout archetype grammar.
        library: Pattern library under evaluation.
        blocks: Per-block coverage results from `block_coverage`.

    Returns:
        A tuple of `ArchetypeCoverage` entries for all archetypes in `grammar`.
    """
    by_block = {b.block_id: b for b in blocks}
    has_page = library.has_pattern("page")
    return tuple(
        _single_archetype_coverage(arch, library, by_block, has_page=has_page)
        for arch in grammar.archetypes
    )


def _unknown_pattern_names(
    grammar: ArchetypeGrammar, library: PatternLibrary
) -> tuple[str, ...]:
    """Returns pattern names in `library` not referenced by `page` or any grammar block.

    Args:
        grammar: Layout archetype grammar.
        library: Pattern library under evaluation.

    Returns:
        Sorted tuple of unreferenced pattern names.
    """
    known: set[str] = {"page"}
    for block in grammar.blocks.values():
        known.add(PatternRef.parse(block.pattern).name)
        for fb in block.fallback:
            known.add(PatternRef.parse(fb).name)
    return tuple(sorted(name for name in library.patterns if name not in known))


def _validate_single_template(
    loaded: LoadedCatalog,
    template: SurfaceTemplate,
    samples: Mapping[str, Mapping[str, Any]],
    sample_pointer_paths: Mapping[str, set[str]],
) -> list[TemplateValidationFailure]:
    """Lints and validates one `SurfaceTemplate` against matching sample payloads.

    Args:
        loaded: Loaded catalog bundle.
        template: Surface template under validation.
        samples: Mapping from sample name to sample payload dictionary.
        sample_pointer_paths: Mapping from sample name to its discovered JSON Pointers.

    Returns:
        List of `TemplateValidationFailure` records for `template`.
    """
    failures: list[TemplateValidationFailure] = []
    for finding in lint_components(list(template.components), plan=None):
        if finding.severity == "error":
            failures.append(
                TemplateValidationFailure(
                    template_id=template.template_id,
                    sample=None,
                    stage="lint",
                    message=f"{finding.code}: {finding.message}",
                )
            )

    matched_samples = [
        name
        for name, ptrs in sample_pointer_paths.items()
        if template.matches_payload(ptrs)
    ]
    if not matched_samples:
        failures.append(
            TemplateValidationFailure(
                template_id=template.template_id,
                sample=None,
                stage="payload",
                message=(
                    "No sample payload in --payload satisfies requiredPointers"
                    f" {list(template.required_pointers)}."
                ),
            )
        )
        return failures

    for sample_name in matched_samples:
        try:
            messages = template.render_messages(samples[sample_name])
            validate_payload(loaded.graph.catalogs, messages)
        except (A2uiError, ValueError, TypeError) as exc:
            failures.append(
                TemplateValidationFailure(
                    template_id=template.template_id,
                    sample=sample_name,
                    stage="schema",
                    message=_first_line(exc),
                )
            )
    return failures


def validate_templates(
    loaded: LoadedCatalog,
    registry: TemplateRegistry,
    samples: Mapping[str, Mapping[str, Any]],
    sample_pointer_paths: Mapping[str, set[str]],
) -> tuple[int, list[TemplateValidationFailure]]:
    """Validates all templates in `registry` against `loaded.catalog` and `samples`.

    Args:
        loaded: Loaded catalog bundle.
        registry: Loaded surface template registry.
        samples: Mapping from sample name to payload dictionary.
        sample_pointer_paths: Mapping from sample name to discovered pointer paths.

    Returns:
        A `(templates_validated, failures)` pair.

    Raises:
        ToolError: If any template's `catalogId` does not match `loaded.catalog.catalog_id`.
    """
    target_cat_id = loaded.catalog.catalog_id
    for tpl in registry.list_templates():
        if tpl.catalog_id is not None and tpl.catalog_id != target_cat_id:
            raise ToolError(
                f"Template '{tpl.template_id}' catalogId '{tpl.catalog_id}' does not"
                f" match catalog '{target_cat_id}'."
            )

    failures: list[TemplateValidationFailure] = []
    templates = registry.list_templates()
    for tpl in templates:
        failures.extend(
            _validate_single_template(loaded, tpl, samples, sample_pointer_paths)
        )
    return (len(templates), failures)


def _resolve_sidecar_paths(
    loaded: LoadedCatalog,
    patterns_path: str | Path | None,
    templates_path: str | Path | None,
) -> tuple[Path | None, Path | None]:
    """Resolves explicit or auto-discovered `patterns.json` and `templates.json` paths.

    Args:
        loaded: Loaded catalog bundle providing `target_dir` for auto-discovery.
        patterns_path: Optional explicit path to `patterns.json`.
        templates_path: Optional explicit path to `templates.json`.

    Returns:
        A `(patterns_path, templates_path)` pair where at least one path is non-`None`.

    Raises:
        ToolError: If neither sidecar is provided or auto-discovered in `loaded.target_dir`.
    """
    p_path = Path(patterns_path).resolve() if patterns_path is not None else None
    t_path = Path(templates_path).resolve() if templates_path is not None else None
    if p_path is None and t_path is None:
        cand_p = loaded.target_dir / "patterns.json"
        cand_t = loaded.target_dir / "templates.json"
        if cand_p.is_file():
            p_path = cand_p.resolve()
        if cand_t.is_file():
            t_path = cand_t.resolve()
    if p_path is None and t_path is None:
        raise ToolError(
            f"No patterns.json or templates.json found in {loaded.target_dir};"
            " pass --patterns and/or --templates, or place them alongside catalog.json."
        )
    return (p_path, t_path)


def _evaluate_pattern_library(
    loaded: LoadedCatalog,
    library: PatternLibrary,
    *,
    patterns_path: Path | None = None,
) -> tuple[
    int,
    list[ExpansionFailure],
    list[str],
    tuple[str, ...],
    tuple[BlockCoverage, ...],
    tuple[ArchetypeCoverage, ...],
]:
    """Runs dry-run expansion and coverage analysis on `library`.

    Args:
        loaded: Loaded catalog bundle.
        library: Parsed pattern library under validation.
        patterns_path: Optional path to `patterns.json` for diagnostic messages.

    Returns:
        A `(expansions_run, failures, warnings, unknown_patterns, blocks_coverage,
        archetypes_coverage)` tuple.
    """
    unknown = _unknown_pattern_names(loaded.grammar, library)
    expander = PatternExpander(library, loaded.graph, grammar=loaded.grammar)
    expansions_run, failures, warnings = dry_run_page(
        expander,
        loaded.grammar,
        library,
        loaded.graph,
        patterns_path=patterns_path,
    )
    for block in loaded.grammar.blocks.values():
        b_runs, b_fails, b_warns = dry_run_block(
            expander,
            library,
            block,
            loaded.graph,
            patterns_path=patterns_path,
        )
        expansions_run += b_runs
        failures.extend(b_fails)
        warnings.extend(b_warns)

    blocks_cov = block_coverage(loaded.grammar, library)
    archs_cov = archetype_coverage(loaded.grammar, library, blocks_cov)
    return (expansions_run, failures, warnings, unknown, blocks_cov, archs_cov)


def _evaluate_single_sample(
    loaded: LoadedCatalog,
    sample_name: str,
    sample_payload: Mapping[str, Any],
    library: PatternLibrary | None,
    registry: TemplateRegistry | None,
) -> tuple[PayloadSampleReport, set[str]]:
    """Evaluates one sample payload against `library` and `registry`.

    Args:
        loaded: Loaded catalog bundle.
        sample_name: Identifier of the sample payload.
        sample_payload: Sample data model dictionary.
        library: Optional pattern library for archetype eligibility evaluation.
        registry: Optional surface template registry for `requiredPointers` matching.

    Returns:
        A `(sample_report, pointer_paths_set)` pair.
    """
    ptrs = inspect_payload_pointers(sample_payload)
    ptr_set = {p.path for p in ptrs}
    el_ids = (
        tuple(a.id for a in eligible_archetypes(loaded.grammar, library, ptrs))
        if library is not None
        else ()
    )
    matched_tpls = (
        tuple(t.template_id for t in registry.matching_templates(ptr_set))
        if registry is not None
        else ()
    )
    return (
        PayloadSampleReport(
            sample_name=sample_name,
            pointer_count=len(ptrs),
            eligible_archetypes=el_ids,
            matching_templates=matched_tpls,
        ),
        ptr_set,
    )


def _evaluate_sample_payloads(
    loaded: LoadedCatalog,
    samples: Mapping[str, Mapping[str, Any]],
    library: PatternLibrary | None,
    registry: TemplateRegistry | None,
) -> tuple[list[PayloadSampleReport], dict[str, set[str]], list[str]]:
    """Evaluates `samples` against `library` and `registry`.

    Args:
        loaded: Loaded catalog bundle.
        samples: Mapping from sample name to sample payload dictionary.
        library: Optional pattern library.
        registry: Optional surface template registry.

    Returns:
        A `(sample_reports, sample_pointer_paths, union_eligible_archetypes)` tuple.
    """
    sample_reports: list[PayloadSampleReport] = []
    sample_ptr_paths: dict[str, set[str]] = {}
    union_eligible: list[str] = []

    for s_name, s_payload in samples.items():
        report, ptr_set = _evaluate_single_sample(
            loaded, s_name, s_payload, library, registry
        )
        sample_reports.append(report)
        sample_ptr_paths[s_name] = ptr_set
        for aid in report.eligible_archetypes:
            if aid not in union_eligible:
                union_eligible.append(aid)
    return (sample_reports, sample_ptr_paths, union_eligible)


def validate_catalog_artifacts(
    loaded: LoadedCatalog,
    *,
    payload_path: str | Path,
    patterns_path: str | Path | None = None,
    templates_path: str | Path | None = None,
) -> ValidationReport:
    """Validates `patterns.json` and/or `templates.json` with required `--payload` samples.

    Executes the five validation stages in order:
    1. Sidecar JSON Schema and `catalogId` / `grammarVersion` parity checks.
    2. Combinatorial dry-run expansion of `page` and all 19 grammar blocks across knobs.
    3. Structural component topology and directive linting (`lint_components`).
    4. Catalog wire message validation (`to_message_models` and `validate_payload`).
    5. Runtime sample payload eligibility (`eligible_archetypes`) and template matching.

    Args:
        loaded: Loaded catalog bundle.
        payload_path: Path to the sample payloads JSON file (`--payload`).
        patterns_path: Optional explicit path to `patterns.json`.
        templates_path: Optional explicit path to `templates.json`.

    Returns:
        The populated `ValidationReport`.

    Raises:
        ToolError: If sidecar files cannot be resolved, fail schema parsing, or mismatch
            `catalogId` or `grammarVersion`.
    """
    resolved_payload_path = Path(payload_path).resolve()
    samples = load_sample_payloads(resolved_payload_path)
    p_path, t_path = _resolve_sidecar_paths(loaded, patterns_path, templates_path)

    library: PatternLibrary | None = None
    if p_path is not None:
        library = load_pattern_library(p_path, grammar=loaded.grammar)
        if library.catalog_id != loaded.catalog.catalog_id:
            raise ToolError(
                f"Patterns file {p_path} catalogId '{library.catalog_id}' does"
                f" not match catalog '{loaded.catalog.catalog_id}' (see"
                " patterns_authoring_guide.md#top-level-file-structure)."
            )
        if library.grammar_version != loaded.grammar.version:
            raise ToolError(
                f"Patterns file {p_path} grammarVersion '{library.grammar_version}'"
                f" does not match grammar version '{loaded.grammar.version}' (see"
                " patterns_authoring_guide.md#top-level-file-structure)."
            )

    registry = load_template_registry(t_path) if t_path is not None else None
    expansions_run = 0
    failures: list[ExpansionFailure] = []
    warnings: list[str] = []
    unknown: tuple[str, ...] = ()
    blocks_cov: tuple[BlockCoverage, ...] = ()
    archs_cov: tuple[ArchetypeCoverage, ...] = ()

    if library is not None:
        (
            expansions_run,
            failures,
            warnings,
            unknown,
            blocks_cov,
            archs_cov,
        ) = _evaluate_pattern_library(loaded, library, patterns_path=p_path)

    sample_reports, sample_ptr_paths, union_eligible = _evaluate_sample_payloads(
        loaded, samples, library, registry
    )

    if library is not None and not union_eligible:
        failures.append(
            ExpansionFailure(
                pattern="<payload>",
                block_id=None,
                knobs={},
                stage="payload",
                message=_format_failure_message(
                    file_path=resolved_payload_path,
                    pattern="<payload>",
                    component_id="<none>",
                    prop="samples",
                    rule=(
                        "Zero archetypes are eligible across all sample payloads in"
                        " --payload."
                    ),
                    anchor="sample-payloads",
                ),
            )
        )

    templates_validated = 0
    template_failures: list[TemplateValidationFailure] = []
    if registry is not None:
        templates_validated, template_failures = validate_templates(
            loaded, registry, samples, sample_ptr_paths
        )

    return ValidationReport(
        catalog_id=loaded.catalog.catalog_id,
        patterns_path=p_path,
        templates_path=t_path,
        payload_path=resolved_payload_path,
        schema_ok=True,
        schema_error=None,
        unknown_patterns=unknown,
        warnings=tuple(warnings),
        expansions_run=expansions_run,
        failures=tuple(failures),
        templates_validated=templates_validated,
        template_failures=tuple(template_failures),
        blocks=blocks_cov,
        archetypes=archs_cov,
        payload_samples=tuple(sample_reports),
        payload_eligible=tuple(union_eligible),
    )


def report_to_dict(report: ValidationReport) -> dict[str, Any]:
    """Serializes `report` to a JSON-compatible dictionary.

    Args:
        report: Validation report to serialize.

    Returns:
        A camelCase dictionary suitable for JSON serialization.
    """
    return {
        "ok": report.ok,
        "catalogId": report.catalog_id,
        "patternsPath": str(report.patterns_path) if report.patterns_path else None,
        "templatesPath": str(report.templates_path) if report.templates_path else None,
        "payloadPath": str(report.payload_path),
        "schemaOk": report.schema_ok,
        "schemaError": report.schema_error,
        "unknownPatterns": list(report.unknown_patterns),
        "warnings": list(report.warnings),
        "expansionsRun": report.expansions_run,
        "failures": [
            {
                "pattern": f.pattern,
                "blockId": f.block_id,
                "knobs": dict(f.knobs),
                "stage": f.stage,
                "message": f.message,
            }
            for f in report.failures
        ],
        "templatesValidated": report.templates_validated,
        "templateFailures": [
            {
                "templateId": tf.template_id,
                "sample": tf.sample,
                "stage": tf.stage,
                "message": tf.message,
            }
            for tf in report.template_failures
        ],
        "blocks": [
            {
                "blockId": b.block_id,
                "resolution": b.resolution,
                "pattern": b.pattern,
                "via": b.via,
            }
            for b in report.blocks
        ],
        "archetypes": [
            {
                "archetypeId": a.archetype_id,
                "family": a.family,
                "eligible": a.eligible,
                "missingRequired": list(a.missing_required),
                "degradedRequired": list(a.degraded_required),
                "missingCriteriaPatterns": list(a.missing_criteria_patterns),
                "viableBlocks": a.viable_blocks,
                "atLeast": a.at_least,
            }
            for a in report.archetypes
        ],
        "payloadSamples": [
            {
                "sampleName": s.sample_name,
                "pointerCount": s.pointer_count,
                "eligibleArchetypes": list(s.eligible_archetypes),
                "matchingTemplates": list(s.matching_templates),
            }
            for s in report.payload_samples
        ],
        "payloadEligible": list(report.payload_eligible),
    }


def _append_warnings_and_unknown_patterns(
    lines: list[str], report: ValidationReport
) -> None:
    """Appends unknown pattern and warning sections to `lines` when present.

    Args:
        lines: Mutable Markdown output line buffer.
        report: Validation report containing unknown pattern names and warnings.
    """
    if report.unknown_patterns:
        unknown = ", ".join(f"`{name}`" for name in report.unknown_patterns)
        lines.extend(["", f"## Unknown Patterns: {unknown}"])
    if report.warnings:
        lines.extend(["", "## Warnings", ""])
        lines.extend(f"- {warning}" for warning in report.warnings)


def _append_failure_tables(lines: list[str], report: ValidationReport) -> None:
    """Appends pattern failure, template failure, unknown pattern, and warning sections to `lines`.

    Args:
        lines: Mutable Markdown output line buffer.
        report: Validation report containing failures, unknown patterns, and warnings.
    """
    if report.failures:
        lines.extend(["", "## Pattern & Payload Failures", ""])
        rows = [
            [
                f"`{f.pattern}`",
                f"`{f.block_id or '-'}`",
                f"`{f.stage}`",
                ", ".join(f"{k}={v}" for k, v in f.knobs.items()) or "-",
                f.message,
            ]
            for f in report.failures
        ]
        lines.append(
            render_markdown_table(
                ["Pattern", "Block", "Stage", "Knobs", "Message"], rows
            )
        )
    if report.template_failures:
        lines.extend(["", "## Surface Template Failures", ""])
        rows = [
            [
                f"`{tf.template_id}`",
                f"`{tf.sample or '-'}`",
                f"`{tf.stage}`",
                tf.message,
            ]
            for tf in report.template_failures
        ]
        lines.append(
            render_markdown_table(["Template ID", "Sample", "Stage", "Message"], rows)
        )
    _append_warnings_and_unknown_patterns(lines, report)


def _archetype_row(arch: ArchetypeCoverage) -> list[str]:
    """Formats one `ArchetypeCoverage` row for the Markdown table.

    Args:
        arch: Archetype coverage entry to format.

    Returns:
        List of six Markdown table cells.
    """
    return [
        f"`{arch.archetype_id}`",
        arch.family,
        "yes" if arch.eligible else "no",
        ", ".join(arch.missing_required) or "-",
        ", ".join(arch.degraded_required) or "-",
        f"{arch.viable_blocks}/{arch.at_least}",
    ]


def _sample_row(sample: PayloadSampleReport) -> list[str]:
    """Formats one `PayloadSampleReport` row for the Markdown table.

    Args:
        sample: Payload sample report entry to format.

    Returns:
        List of four Markdown table cells.
    """
    return [
        f"`{sample.sample_name}`",
        str(sample.pointer_count),
        ", ".join(f"`{a}`" for a in sample.eligible_archetypes) or "-",
        ", ".join(f"`{t}`" for t in sample.matching_templates) or "-",
    ]


def report_to_markdown(report: ValidationReport) -> str:
    """Renders `report` as a Markdown summary.

    Args:
        report: Validation report to format.

    Returns:
        The formatted Markdown report ending with a newline.
    """
    status = "PASSED" if report.ok else "FAILED"
    lines: list[str] = [
        f"# Catalog Validation ({status}): `{report.catalog_id}`",
        "",
        f"- **Patterns File**: `{report.patterns_path or 'none'}`",
        f"- **Templates File**: `{report.templates_path or 'none'}`",
        f"- **Sample Payloads File**: `{report.payload_path}`",
        (
            f"- **Pattern Expansions Dry-Run**: `{report.expansions_run}`"
            f" (`{len(report.failures)}` failures)"
        ),
        (
            f"- **Surface Templates Validated**: `{report.templates_validated}`"
            f" (`{len(report.template_failures)}` failures)"
        ),
    ]
    _append_failure_tables(lines, report)

    if report.archetypes:
        el_count = sum(1 for a in report.archetypes if a.eligible)
        lines.extend([
            "",
            (
                f"## Archetype Coverage ({el_count}/{len(report.archetypes)}"
                " pattern-eligible)"
            ),
            "",
            render_markdown_table(
                [
                    "Archetype",
                    "Family",
                    "Pattern-Eligible",
                    "Missing Required",
                    "Degraded Required",
                    "Viable Blocks",
                ],
                [_archetype_row(a) for a in report.archetypes],
            ),
        ])

    lines.extend([
        "",
        "## Sample Payload Verification (`--payload`)",
        "",
        render_markdown_table(
            [
                "Sample",
                "Pointers",
                "Eligible Archetypes",
                "Matching Templates",
            ],
            [_sample_row(s) for s in report.payload_samples],
        ),
    ])
    return "\n".join(lines) + "\n"
