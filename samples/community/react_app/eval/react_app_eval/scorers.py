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

"""Scorers for the ReactApp and Express multi-line suites.

Both run after the runner's `a2ui_scorer` (Stage 1 validation and Stage 2
assertions) and before the LLM judge. Each returns a dictionary score, so every
check gets its own pass rate in the eval log, plus an `all` key that is 1 only
when every hard check passed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats.express import ExpressDecompiler
from a2ui_eval.runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    parse_and_validate,
    runner_options_from_metadata,
)
from a2ui_eval.shared.utils import GIT_ROOT
from a2ui_react_app import (
    CompileResult,
    ReactAppCompiler,
    ReactAppTransformer,
    check_react_app,
)
from inspect_ai.model import ChatMessageAssistant
from inspect_ai.scorer import Score, Scorer, Target, mean, scorer
from inspect_ai.solver import TaskState
from pydantic import TypeAdapter

from .facts import SourceFacts, iter_react_apps, iter_strings, source_facts
from .solvers import BINDINGS_KEY, sample_catalogs, shared_compiler

__all__ = [
    "EXPRESS_KEYS",
    "REACT_APP_KEYS",
    "express_multiline_scorer",
    "path_covered",
    "raw_completion",
    "react_app_scorer",
]

REACT_APP_KEYS = (
    "present",
    "compiles",
    "typechecks",
    "paths",
    "functions",
    "imports",
    "styling",
    "all",
)
"""Keys of the ReactApp score. `typechecks` is reported but not part of `all`."""

EXPRESS_KEYS = ("parses", "raw_strings", "literals", "roundtrip", "all")
"""Keys of the Express multi-line score."""

_LONG_TEXT_NEWLINES = 2
"""Newlines from which a value counts as code or long text that must be raw."""

_STRUCTURAL_CODES = frozenset(
    {"forbidden_import", "missing_default_export", "triple_quote"}
)
_MESSAGES = TypeAdapter(list[AgentToRendererMessage])


def path_covered(expected: str, used: Iterable[str]) -> bool:
    """Whether the app uses `expected`, or a path above it (reading `/loan` covers `/loan/rate`)."""
    return any(
        expected == path or expected.startswith(f"{path.rstrip('/')}/") for path in used
    )


def raw_completion(state: TaskState) -> str:
    """The model's last raw reply, before the compile step replaced the output."""
    for message in reversed(state.messages):
        if isinstance(message, ChatMessageAssistant):
            return message.text
    return ""


def _merge(facts: Sequence[SourceFacts]) -> SourceFacts:
    return SourceFacts(
        read_paths=frozenset().union(*(f.read_paths for f in facts)),
        written_paths=frozenset().union(*(f.written_paths for f in facts)),
        functions=frozenset().union(*(f.called_functions for f in facts)),
        actions=frozenset().union(*(f.actions for f in facts)),
        a2ui_imports=frozenset().union(*(f.a2ui_imports for f in facts)),
        uses_css_vars=any(f.uses_css_vars for f in facts),
        uses_theme=any(f.uses_theme for f in facts),
        hard_coded_colors=sum(f.hard_coded_colors for f in facts),
    )


def _zero(keys: Sequence[str]) -> dict[str, float]:
    return {key: 0.0 for key in keys}


@scorer(metrics={key: [mean()] for key in REACT_APP_KEYS})
def react_app_scorer(
    compiler: Callable[[], ReactAppCompiler] = shared_compiler,
) -> Scorer:
    """Checks the ReactApp components of the compiled payload.

    Keys: `present` (a ReactApp exists), `compiles` (Sucrase, as in the frame),
    `typechecks` (TypeScript against `a2ui.d.ts`, `@types/react` and the
    sample's `a2ui:bindings` declarations, through the server compiler; reported only), `paths` (the
    app reads or writes every path of `expect.paths`), `functions` (it calls
    every function of `expect.functions`), `imports` (only allowed modules, a
    default export, no three double quotes), `styling` (primitives, theme or
    `var(--a2ui-*)`, and no color literals), and `all`.
    """

    async def score(state: TaskState, target: Target) -> Score:  # pylint: disable=unused-argument
        compiled = state.metadata.get("compiled_messages") or []
        apps = list(iter_react_apps(compiled))
        if not apps:
            reason = (
                "The payload did not compile."
                if not compiled
                else "The payload has no ReactApp component."
            )
            return Score(value=_zero(REACT_APP_KEYS), explanation=reason)

        expect: Mapping[str, Any] = state.metadata.get("expect") or {}
        sources = [str(app.get("source") or "") for app in apps]
        declarations = state.metadata.get(BINDINGS_KEY)
        results: list[CompileResult] = [
            await asyncio.to_thread(compiler().compile, source, bindings=declarations)
            for source in sources
        ]
        facts = _merge([source_facts(source) for source in sources])
        diagnostics = [
            d
            for app in apps
            for d in check_react_app(
                ReactAppTransformer.fill_allowlists(
                    {k: v for k, v in app.items() if k != "compiled"}
                )
            )
        ]

        problems: list[str] = []
        value: dict[str, float] = {"present": 1.0}
        value["compiles"] = float(all(r.compiled is not None for r in results))
        if not value["compiles"]:
            problems += [
                f"Sucrase: {d.message}"
                for r in results
                for d in r.diagnostics
                if d.phase == "transpile"
            ]
        value["typechecks"] = float(all(r.ok for r in results))
        type_errors = [d for r in results for d in r.diagnostics if d.phase == "type"]
        if type_errors:
            problems += [
                f"tsc {e.line}:{e.column}: {e.message.splitlines()[0]}"
                for e in type_errors[:5]
            ]
        missing_paths = [
            p for p in expect.get("paths") or [] if not path_covered(p, facts.paths)
        ]
        value["paths"] = float(not missing_paths)
        if missing_paths:
            problems.append(
                f"Paths not used: {', '.join(missing_paths)} (used:"
                f" {', '.join(sorted(facts.paths)) or 'none'})"
            )
        missing_functions = [
            f for f in expect.get("functions") or [] if f not in facts.functions
        ]
        value["functions"] = float(not missing_functions)
        if missing_functions:
            problems.append(
                f"Functions not called: {', '.join(missing_functions)} (called:"
                f" {', '.join(sorted(facts.functions)) or 'none'})"
            )
        structural = [d for d in diagnostics if d.code in _STRUCTURAL_CODES]
        value["imports"] = float(not structural)
        problems += [d.describe() for d in structural]
        colors_ok = facts.hard_coded_colors == 0 or bool(
            expect.get("allow_color_literals")
        )
        value["styling"] = float(facts.themed and colors_ok)
        if not value["styling"]:
            problems.append(
                "Styling: "
                + ("no primitives, theme or var(--a2ui-*)" if not facts.themed else "")
                + (
                    f"{facts.hard_coded_colors} color literal(s)"
                    if not colors_ok
                    else ""
                )
            )
        hard = ("present", "compiles", "paths", "functions", "imports", "styling")
        value["all"] = float(all(value[key] for key in hard))

        state.metadata["react_app_check"] = {
            "apps": len(apps),
            "source_chars": sum(len(s) for s in sources),
            "type_errors": len(type_errors),
            "check_ms": sum(r.round_trip_ms for r in results),
            "paths": sorted(facts.paths),
            "functions": sorted(facts.functions),
            "primitives": sorted(facts.primitives),
            "hard_coded_colors": facts.hard_coded_colors,
        }
        return Score(
            value=value,
            answer="\n\n".join(sources),
            explanation="; ".join(problems)
            if problems
            else "All ReactApp checks passed.",
        )

    return score


def _string_leaves(messages: Sequence[Any]) -> list[str]:
    return sorted(iter_strings(list(messages)))


def _round_trip(
    state: TaskState, compiled: list[dict[str, Any]], version: str
) -> str | None:
    """Decompiles and recompiles the payload; returns a problem, or None when strings match."""
    catalogs = sample_catalogs(state.metadata, version)
    decompiler = ExpressDecompiler(catalogs)
    text = decompiler.wrap_decompiled_blocks([
        decompiler.decompile(_MESSAGES.validate_python(compiled), use_keyword_args=True)
    ])
    resolved_catalog_path = str(GIT_ROOT / str(state.metadata["catalog"]))
    result = parse_and_validate(
        "express",
        version,
        resolved_catalog_path,
        str((state.metadata.get("allowed_surface_ids") or ["main"])[0]),
        text,
        DEFAULT_PARSE_TIMEOUT_SEC,
        validate=False,
        options=runner_options_from_metadata(state.metadata, resolved_catalog_path),
    )
    before, after = _string_leaves(compiled), _string_leaves(
        result.get("compiled_jsons") or []
    )
    if before == after:
        return None
    changed = sorted(set(before) ^ set(after))
    return f"Strings changed in a decompile/compile round trip: {changed[:3]!r}"


@scorer(metrics={key: [mean()] for key in EXPRESS_KEYS})
def express_multiline_scorer(version: str = "1.0") -> Scorer:
    """Checks how the model wrote multi-line strings in Express.

    Keys: `parses` (the completion compiled), `raw_strings` (every value of
    three or more lines that can be raw was written as `r\"\"\"...\"\"\"`), `literals` (every
    string of `expect.literals` appears verbatim in some value), `roundtrip`
    (decompiling and recompiling the payload keeps every string byte for byte),
    and `all`.
    """

    async def score(state: TaskState, target: Target) -> Score:  # pylint: disable=unused-argument
        compiled = state.metadata.get("compiled_messages") or []
        if not compiled:
            return Score(
                value=_zero(EXPRESS_KEYS), explanation="The payload did not compile."
            )
        expect: Mapping[str, Any] = state.metadata.get("expect") or {}
        raw = raw_completion(state)
        strings = list(iter_strings(compiled))
        problems: list[str] = []
        value: dict[str, float] = {"parses": 1.0}

        # The prompt asks for raw strings for code and long multi-line text, so
        # a short value with one `\n` escape may stay a regular string.
        multiline = [s for s in strings if s.count("\n") >= _LONG_TEXT_NEWLINES]
        rawable = [s for s in multiline if '"""' not in s and not s.endswith('"')]
        not_raw = [s for s in rawable if f'r"""{s}"""' not in raw]
        needs_multiline = bool(expect.get("multiline"))
        has_multiline = any("\n" in s for s in strings)
        value["raw_strings"] = float(
            not not_raw and (has_multiline or not needs_multiline)
        )
        if not_raw:
            problems.append(
                f'{len(not_raw)} multi-line value(s) not written as r"""…"""'
            )
        if needs_multiline and not has_multiline:
            problems.append("Expected a multi-line value, found none")

        missing = [
            lit
            for lit in expect.get("literals") or []
            if not any(lit in s for s in strings)
        ]
        value["literals"] = float(not missing)
        if missing:
            problems.append(
                f"Literals not found verbatim: {[m[:60] for m in missing]!r}"
            )

        try:
            trip_problem = await asyncio.to_thread(
                _round_trip, state, compiled, version
            )
        except Exception as error:  # pylint: disable=broad-exception-caught
            trip_problem = f"Round trip failed: {error}"
        value["roundtrip"] = float(trip_problem is None)
        if trip_problem:
            problems.append(trip_problem)

        value["all"] = float(
            all(value[k] for k in ("parses", "raw_strings", "literals", "roundtrip"))
        )
        return Score(
            value=value,
            explanation="; ".join(problems)
            if problems
            else "All Express multi-line checks passed.",
        )

    return score
