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

from a2ui.core import A2uiError, CatalogApi
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

_CRITERIA_PATTERN_RE = re.compile(r"\bpattern:([a-z_]+)(?::([a-z_]+))?\b")


@dataclass(frozen=True)
class ExpansionFailure:
    """One failure recorded while expanding, linting, or schema-checking a pattern."""

    pattern: str
    block_id: str | None
    knobs: Mapping[str, str]
    stage: Literal["expand", "lint", "schema", "payload"]
    message: str


@dataclass(frozen=True)
class TemplateValidationFailure:
    """One failure recorded while linting, matching, or rendering a `SurfaceTemplate`."""

    template_id: str
    sample: str | None
    stage: Literal["lint", "schema", "payload"]
    message: str


@dataclass(frozen=True)
class BlockCoverage:
    """How one layout grammar block resolves against a `PatternLibrary`."""

    block_id: str
    resolution: Literal["direct", "fallback", "unavailable"]
    pattern: str | None
    via: str | None


@dataclass(frozen=True)
class ArchetypeCoverage:
    """Pattern-level coverage for one layout archetype."""

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
    """Per-sample eligibility and template matching results."""

    sample_name: str
    pointer_count: int
    eligible_archetypes: tuple[str, ...]
    matching_templates: tuple[str, ...]


@dataclass(frozen=True)
class ValidationReport:
    """Complete validation report across `patterns.json`, `templates.json`, and `--payload`."""

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
        """Whether all schema, pattern, template, and payload checks passed."""
        return self.schema_ok and not self.failures and not self.template_failures


def _wire_version(protocol_version: str) -> str:
    """Returns `'1.0'` for 1.x protocol versions and `'v0.9'` otherwise."""
    clean = protocol_version.strip().lstrip("v")
    return "1.0" if clean == "1" or clean.startswith("1.") else "v0.9"


def surface_messages(
    graph: CatalogDecisionGraph,
    components: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    *,
    ensure_root: bool = False,
) -> list[dict[str, Any]]:
    """Builds the wire-format `createSurface` + `updateComponents` + `updateDataModel` batch."""
    version = _wire_version(graph.protocol_version)
    create_body: dict[str, Any] = {"surfaceId": "validation_surface"}
    if graph.surface_catalog_id is not None:
        create_body["catalogId"] = graph.surface_catalog_id
    copied = [copy.deepcopy(dict(c)) for c in components]
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
    """Returns the first non-empty line of an exception message."""
    for line in str(exc).splitlines():
        if line.strip():
            return line.strip()
    return type(exc).__name__


def _check_expanded_surface(
    pattern_name: str,
    block_id: str | None,
    knobs: Mapping[str, str],
    components: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    graph: CatalogDecisionGraph,
) -> list[ExpansionFailure]:
    """Runs `lint_components` and `validate_payload` on an expanded component list."""
    failures: list[ExpansionFailure] = []
    for finding in lint_components(components, plan=None):
        if finding.severity == "error":
            failures.append(
                ExpansionFailure(
                    pattern=pattern_name,
                    block_id=block_id,
                    knobs=dict(knobs),
                    stage="lint",
                    message=f"{finding.code}: {finding.message}",
                )
            )
    try:
        raw_msgs = surface_messages(
            graph, components, payload, ensure_root=block_id is not None
        )
        models = to_message_models(raw_msgs)
        validate_payload(graph.catalogs, models)
    except (A2uiError, ValueError, TypeError) as exc:
        failures.append(
            ExpansionFailure(
                pattern=pattern_name,
                block_id=block_id,
                knobs=dict(knobs),
                stage="schema",
                message=_first_line(exc),
            )
        )
    return failures


def _check_unreachable_variants(
    pattern: CatalogPattern, combos: Sequence[Mapping[str, str]]
) -> list[str]:
    """Warns when a declared variant with `when` is never selected by any knob combo."""
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
) -> tuple[int, list[ExpansionFailure], list[str]]:
    """Dry-runs `block` across all knob combinations of its resolved pattern."""
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
    failures: list[ExpansionFailure] = []
    runs = 0

    for knobs in combos:
        merged_knobs = {**resolved.knobs, **knobs}
        runs += 1
        try:
            expanded = expander.expand_block(
                block.id,
                block.pattern,
                bindings,
                merged_knobs,
                instances,
                block.id,
            )
        except (PatternError, A2uiError, KeyError, ValueError) as exc:
            failures.append(
                ExpansionFailure(
                    pattern=cat_pattern.name,
                    block_id=block.id,
                    knobs=merged_knobs,
                    stage="expand",
                    message=_first_line(exc),
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
            )
        )
    return (runs, failures, warnings)


def _expand_seed_block_for_page(
    expander: PatternExpander,
    grammar: ArchetypeGrammar,
    library: PatternLibrary,
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    """Expands one real block so `expand_page` has a valid child component root ID."""
    preferred_order = ("prose", *grammar.blocks.keys())
    for block_id in preferred_order:
        block = grammar.blocks.get(block_id)
        if block is None or resolve_fallback_pattern(block, library) is None:
            continue
        bindings = synthetic_block_bindings(block)
        instances = synthetic_instances(block, bindings)
        try:
            comps = expander.expand_block(
                block.id, block.pattern, bindings, {}, instances, block.id
            )
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
) -> tuple[int, list[ExpansionFailure], list[str]]:
    """Dry-runs the `page` pattern paired with one expanded seed block."""
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
                    message="Pattern 'page' is required in patterns.json.",
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
    failures: list[ExpansionFailure] = []
    runs = 0
    for knobs in combos:
        runs += 1
        try:
            page_comps = expander.expand_page(
                page_bindings, block_roots=block_roots, knobs=knobs
            )
        except (PatternError, A2uiError, KeyError, ValueError) as exc:
            failures.append(
                ExpansionFailure(
                    pattern="page",
                    block_id=None,
                    knobs=dict(knobs),
                    stage="expand",
                    message=_first_line(exc),
                )
            )
            continue
        combined = [*page_comps, *seed_comps]
        failures.extend(
            _check_expanded_surface("page", None, knobs, combined, payload, graph)
        )
    return (runs, failures, warnings)


def block_coverage(
    grammar: ArchetypeGrammar, library: PatternLibrary
) -> tuple[BlockCoverage, ...]:
    """Computes direct, fallback, or unavailable resolution for every grammar block."""
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
    """Returns `pattern:<name>:<variant>` tokens in `criteria` missing from `library`."""
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
    """Computes pattern-level coverage for one `LayoutArchetype`."""
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
    """Computes pattern-level eligibility for all 14 archetypes."""
    by_block = {b.block_id: b for b in blocks}
    has_page = library.has_pattern("page")
    return tuple(
        _single_archetype_coverage(arch, library, by_block, has_page=has_page)
        for arch in grammar.archetypes
    )


def _unknown_pattern_names(
    grammar: ArchetypeGrammar, library: PatternLibrary
) -> tuple[str, ...]:
    """Returns pattern names in `library` not referenced by `page` or any grammar block."""
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
    """Lints and validates one `SurfaceTemplate` against matching sample payloads."""
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
    """Validates all templates in `registry` against `loaded.catalog` and `samples`."""
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
    """Resolves explicit or auto-discovered `patterns.json` and `templates.json` paths."""
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


def _evaluate_pattern_library(loaded: LoadedCatalog, library: PatternLibrary) -> tuple[
    int,
    list[ExpansionFailure],
    list[str],
    tuple[str, ...],
    tuple[BlockCoverage, ...],
    tuple[ArchetypeCoverage, ...],
]:
    """Runs dry-run expansion and coverage analysis on `library`."""
    unknown = _unknown_pattern_names(loaded.grammar, library)
    expander = PatternExpander(library, loaded.graph, grammar=loaded.grammar)
    expansions_run, failures, warnings = dry_run_page(
        expander, loaded.grammar, library, loaded.graph
    )
    for block in loaded.grammar.blocks.values():
        b_runs, b_fails, b_warns = dry_run_block(expander, library, block, loaded.graph)
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
    """Evaluates one sample payload against `library` and `registry`."""
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
    """Evaluates `samples` against `library` and `registry`."""
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
    """Validates `patterns.json` and/or `templates.json` with required `--payload` samples."""
    resolved_payload_path = Path(payload_path).resolve()
    samples = load_sample_payloads(resolved_payload_path)
    p_path, t_path = _resolve_sidecar_paths(loaded, patterns_path, templates_path)

    library: PatternLibrary | None = None
    if p_path is not None:
        library = load_pattern_library(p_path)
        if loaded.catalog.catalog_id not in library.catalog_ids:
            raise ToolError(
                f"Patterns file {p_path} catalogIds {list(library.catalog_ids)} does"
                f" not contain catalogId '{loaded.catalog.catalog_id}'."
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
        ) = _evaluate_pattern_library(loaded, library)

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
                message=(
                    "Zero archetypes are eligible across all sample payloads in"
                    " --payload."
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
    """Serializes `report` to a JSON-compatible dictionary."""
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


def _append_failure_tables(lines: list[str], report: ValidationReport) -> None:
    """Appends pattern and template failure tables to `lines` when present."""
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


def _archetype_row(arch: ArchetypeCoverage) -> list[str]:
    """Formats one `ArchetypeCoverage` row for the Markdown table."""
    return [
        f"`{arch.archetype_id}`",
        arch.family,
        "yes" if arch.eligible else "no",
        ", ".join(arch.missing_required) or "-",
        ", ".join(arch.degraded_required) or "-",
        f"{arch.viable_blocks}/{arch.at_least}",
    ]


def _sample_row(sample: PayloadSampleReport) -> list[str]:
    """Formats one `PayloadSampleReport` row for the Markdown table."""
    return [
        f"`{sample.sample_name}`",
        str(sample.pointer_count),
        ", ".join(f"`{a}`" for a in sample.eligible_archetypes) or "-",
        ", ".join(f"`{t}`" for t in sample.matching_templates) or "-",
    ]


def report_to_markdown(report: ValidationReport) -> str:
    """Renders `report` as a Markdown summary."""
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
