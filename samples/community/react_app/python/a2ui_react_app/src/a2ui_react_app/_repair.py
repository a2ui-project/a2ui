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

"""Repair loop: sends a failing ReactApp source and its diagnostics back to the model."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field
import inspect
import logging
import re
import time
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models

from ._bindings import ReactAppBindings
from ._catalog import read_typings
from ._checks import ALLOWED_MODULES, check_react_app
from ._compiler import CompileResult, ReactAppCompiler
from ._transformer import ReactAppTransformer

__all__ = [
    "Generate",
    "RepairAttempt",
    "RepairResult",
    "compile_and_repair",
    "gemini_generate",
    "repair_prompt",
    "repair_react_app",
    "repair_system_instruction",
]

logger = logging.getLogger(__name__)

Generate = Callable[..., Awaitable[str]]
"""Sends one repair prompt to the model (`(prompt)` or `(prompt, system_instruction)`)."""

DEFAULT_REPAIR_MODEL = "gemini-3.5-flash"

_FENCE_RE = re.compile(
    r"(?P<fence>`{3,})(?:tsx|ts|typescript|jsx|js|javascript)?[ \t]*\n(.*?)(?P=fence)",
    re.DOTALL,
)
_RAW_STRING_RE = re.compile(r'r"""(.*?)"""', re.DOTALL)
_LICENSE_HEADER_RE = re.compile(r"\A\s*/\*.*?Copyright.*?\*/\s*", re.DOTALL)


def _fence_for(text: str) -> str:
    """Returns a backtick fence strictly longer than any backtick run in `text`."""
    longest = max((len(m.group(0)) for m in re.finditer(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


@dataclass(frozen=True)
class RepairAttempt:
    """One round of the repair loop.

    Attributes:
        attempt: 1 for the first round.
        problems: The diagnostics sent to the model, one line each.
        model_ms: Time the model took to answer.
        compile_ms: Time the compiler took on the answer.
        ok: Whether the answer passed structural checks and compiled/type-checked.
        reply_chars: Length of the model's reply.
    """

    attempt: int
    problems: tuple[str, ...]
    model_ms: int
    compile_ms: int
    ok: bool
    reply_chars: int


@dataclass
class RepairResult:
    """The outcome of `repair_react_app`.

    Attributes:
        ok: Whether the final source passed structural checks, compiled and type-checked.
        source: The final source (swapped only when a candidate is better).
        compiled: The final source compiled, when it transpiled.
        problems: The remaining diagnostics, one line each.
        attempts: Every round, in order.
        total_ms: Time spent in the whole loop.
        component_id: The component's `id`, when known.
        surface_id: The surface the component is on, when known.
        first_problems: The initial diagnostics before repair.
        compile_ms: Initial compile latency in milliseconds, when recorded.
    """

    ok: bool
    source: str
    compiled: str | None
    problems: list[str] = field(default_factory=list)
    attempts: list[RepairAttempt] = field(default_factory=list)
    total_ms: int = 0
    component_id: str | None = None
    surface_id: str | None = None
    first_problems: list[str] = field(default_factory=list)
    compile_ms: int = 0


def _numbered(source: str) -> str:
    lines = source.split("\n")
    width = len(str(len(lines)))
    return "\n".join(f"{n:>{width}} | {line}" for n, line in enumerate(lines, 1))


def repair_system_instruction(
    *,
    bindings: ReactAppBindings | None = None,
) -> str:
    """Builds the system instruction for the repair model call.

    Holds the static rules, the `a2ui` module typings and the `a2ui:bindings`
    declarations, kept separate from the user turn's source and diagnostics.
    """
    typings = _LICENSE_HEADER_RE.sub("", read_typings(), count=1).rstrip()
    typings_fence = _fence_for(typings)
    modules = ", ".join(f"`{m}`" for m in ALLOWED_MODULES if m != "react/jsx-runtime")
    parts = [
        (
            "You wrote the source of a ReactApp: a React app in one TSX file that"
            " default-exports `App` and runs in a sandboxed frame. It failed to"
            " compile, type-check or pass structural checks. Fix it."
        ),
        "",
        "Rules:",
        f"- Import only from {modules}.",
        (
            "- Keep what the app does and the data paths and functions it uses; change"
            " only what the problems need."
        ),
        (
            "- Call hooks (`useData`, `useFunction`, `useState`, `useEffect`, etc.)"
            " only at the top level of a component, never inside effects, handlers or"
            " loops."
        ),
        (
            "- Never call `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`, and"
            ' never write three double quotes in a row (`"""`).'
        ),
        (
            "- Reply with the complete corrected file in one ```tsx code block, and"
            " nothing else."
        ),
        "",
        "The `a2ui` module:",
        f"{typings_fence}ts",
        typings,
        typings_fence,
    ]
    if bindings is not None and bindings.declarations.strip():
        declarations = bindings.declarations.rstrip()
        decl_fence = _fence_for(declarations)
        parts += [
            "",
            "The `a2ui:bindings` module:",
            f"{decl_fence}ts",
            declarations,
            decl_fence,
        ]
    return "\n".join(parts)


def repair_prompt(
    source: str,
    problems: Sequence[str],
    *,
    bindings: ReactAppBindings | None = None,
    title: str | None = None,
    include_rules: bool = True,
) -> str:
    """Writes the prompt that asks the model to fix one ReactApp source.

    Code blocks use a dynamic backtick fence longer than any backtick run in
    the source or diagnostics, so embedded triple backticks cannot close the
    fence early. When `include_rules` is False, only the user-turn problems
    and numbered source are returned (the rules go in
    `repair_system_instruction`).
    """
    where = f" in `{title}`" if title else ""
    numbered = _numbered(source.rstrip("\n"))
    source_fence = _fence_for(numbered)
    user_parts = [
        f"Problems{where}:",
        *(f"- {problem}" for problem in problems),
        "",
        "Source (with line numbers; do not include the line numbers in your reply):",
        f"{source_fence}tsx",
        numbered,
        source_fence,
    ]
    user_text = "\n".join(user_parts)
    if not include_rules:
        return user_text
    return f"{repair_system_instruction(bindings=bindings)}\n\n{user_text}"


def extract_source(reply: str) -> str | None:
    """Pulls the TSX source out of a model reply (` ```tsx ... ``` ` or `r\"\"\"...\"\"\"`)."""
    fence = _FENCE_RE.search(reply)
    if fence is not None:
        code = fence.group(2).strip("\n")
        return (code + "\n") if code.strip() else None
    raw = _RAW_STRING_RE.search(reply)
    if raw is not None:
        code = raw.group(1).strip("\n")
        return (code + "\n") if code.strip() else None
    return None


def _problems(compiled: CompileResult) -> list[str]:
    return [d.describe() for d in compiled.diagnostics]


def _check_candidate(
    candidate: str,
    component: Mapping[str, Any] | None,
    functions: Collection[str] | None,
    title: str | None,
) -> list[str]:
    base: dict[str, Any] = {
        k: v
        for k, v in (
            component or {"id": title or "app", "component": "ReactApp"}
        ).items()
        if k != "compiled"
    }
    base["source"] = candidate
    base = ReactAppTransformer.fill_allowlists(base)
    return [d.message for d in check_react_app(base, functions=functions)]


def _accepts_system_instruction(generate: Generate) -> bool:
    try:
        params = list(inspect.signature(generate).parameters.values())
    except (TypeError, ValueError):
        return False
    positional = [
        p
        for p in params
        if p.kind
        in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    has_varargs = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
    return len(positional) >= 2 or has_varargs


async def _call_generate(
    generate: Generate,
    source: str,
    problems: Sequence[str],
    *,
    bindings: ReactAppBindings | None,
    title: str | None,
) -> str:
    if _accepts_system_instruction(generate):
        system_instruction = repair_system_instruction(bindings=bindings)
        user_prompt = repair_prompt(
            source, problems, bindings=bindings, title=title, include_rules=False
        )
        return await generate(user_prompt, system_instruction)
    full_prompt = repair_prompt(
        source, problems, bindings=bindings, title=title, include_rules=True
    )
    return await generate(full_prompt)


async def repair_react_app(
    source: str,
    problems: Sequence[str],
    *,
    generate: Generate,
    compiler: ReactAppCompiler,
    bindings: ReactAppBindings | None = None,
    max_attempts: int = 2,
    title: str | None = None,
    component: Mapping[str, Any] | None = None,
    functions: Collection[str] | None = None,
    initial_compiled: str | None = None,
) -> RepairResult:
    """Asks the model to fix a failing ReactApp source, at most `max_attempts` times.

    Each candidate is checked with `check_react_app` (against `component`'s
    allowlists and `functions` when given) and compiled with `compiler`. The
    returned `source` and `compiled` are swapped only when a candidate passes
    all checks (`ok=True`) or has strictly fewer problems than the best seen so
    far; otherwise the original `source` and `initial_compiled` are kept.

    Args:
        source: The failing TSX source.
        problems: The initial diagnostics, one string each.
        generate: Model call (`(prompt)` or `(prompt, system_instruction)`).
        compiler: The compile worker client.
        bindings: Declarations of `a2ui:bindings`, when the app may import it.
        max_attempts: Maximum repair rounds (default 2).
        title: Component id or title for the prompt and logs.
        component: Optional wire-format component dict for structural checks.
        functions: Optional set of declared catalog function names.
        initial_compiled: The initial transpiled JS, if the original source transpiled.
    """
    started = time.perf_counter()
    declarations = (
        bindings.declarations
        if bindings is not None and bindings.declarations.strip()
        else None
    )
    if initial_compiled is None and component is not None:
        raw_compiled = component.get("compiled")
        if isinstance(raw_compiled, str):
            initial_compiled = raw_compiled
    best_source = source
    best_compiled = initial_compiled
    best_problems = list(problems)
    current_source = source
    current_problems = list(problems)
    result = RepairResult(
        ok=False,
        source=best_source,
        compiled=best_compiled,
        problems=list(best_problems),
        component_id=(
            str(component["id"])
            if component is not None and isinstance(component.get("id"), str)
            else title
        ),
        first_problems=list(problems),
    )
    for attempt in range(1, max_attempts + 1):
        sent = tuple(current_problems)
        model_started = time.perf_counter()
        reply = await _call_generate(
            generate,
            current_source,
            current_problems,
            bindings=bindings,
            title=title,
        )
        model_ms = round((time.perf_counter() - model_started) * 1000)
        candidate = extract_source(reply)
        compile_ms = 0
        ok = False
        if candidate is None:
            current_problems = [
                "The reply had no code block. Reply with one ```tsx block."
            ]
        else:
            structural_problems = _check_candidate(
                candidate, component, functions, title
            )
            compile_started = time.perf_counter()
            compiled = await asyncio.to_thread(
                compiler.compile, candidate, bindings=declarations
            )
            compile_ms = round((time.perf_counter() - compile_started) * 1000)
            candidate_problems = structural_problems + _problems(compiled)
            ok = not candidate_problems and compiled.ok
            current_source = candidate
            current_problems = candidate_problems
            # Swap only when the candidate is valid or strictly improves on the best seen.
            is_better = ok or (
                len(candidate_problems) < len(best_problems)
                and (compiled.compiled is not None or best_compiled is None)
            )
            if is_better:
                best_source = candidate
                best_compiled = compiled.compiled
                best_problems = list(candidate_problems)
        result.attempts.append(
            RepairAttempt(
                attempt=attempt,
                problems=sent,
                model_ms=model_ms,
                compile_ms=compile_ms,
                ok=ok,
                reply_chars=len(reply),
            )
        )
        logger.info(
            "ReactApp repair %s attempt %d: %s (model %d ms, compile %d ms)",
            title or "",
            attempt,
            "ok" if ok else f"{len(current_problems)} problem(s) left",
            model_ms,
            compile_ms,
        )
        if ok:
            result.ok = True
            break
    result.source = best_source
    result.compiled = best_compiled
    result.problems = best_problems
    result.total_ms = round((time.perf_counter() - started) * 1000)
    return result


async def compile_and_repair(
    messages: Sequence[AgentToRendererMessage],
    *,
    transformer: ReactAppTransformer,
    generate: Generate,
    max_attempts: int = 2,
) -> tuple[list[AgentToRendererMessage], list[RepairResult]]:
    """Compiles the messages' apps and repairs the ones that fail.

    Runs `transformer.process` (which needs a compiler), then runs
    `repair_react_app` concurrently with `asyncio.gather` for every component
    whose source failed to compile or type-check, and writes improved `source`
    and `compiled` values back into the exact `(message_index, envelope,
    component_index)` slot of each repaired component.

    Returns:
        The messages to send, and one `RepairResult` per repaired component.
    """
    if transformer.compiler is None:
        raise ValueError(
            "compile_and_repair needs a ReactAppTransformer with a compiler."
        )
    compiler = transformer.compiler
    processed = await asyncio.to_thread(transformer.process, messages)
    failing = [
        c
        for c in processed.compiles
        if not c.ok and not any(d.code == "compile_unavailable" for d in c.diagnostics)
    ]
    if not failing:
        return processed.messages, []

    async def repair_one(item: Any) -> RepairResult:
        res = await repair_react_app(
            item.source,
            [d.message for d in item.diagnostics],
            generate=generate,
            compiler=compiler,
            bindings=transformer.bindings,
            max_attempts=max_attempts,
            title=item.component_id,
            component=item.component,
            functions=transformer.declared_functions,
            initial_compiled=item.result.compiled,
        )
        res.component_id = item.component_id
        res.surface_id = item.surface_id
        res.compile_ms = item.result.round_trip_ms
        return res

    repair_list = list(await asyncio.gather(*(repair_one(item) for item in failing)))
    by_slot = {
        (item.message_index, item.envelope, item.component_index): (item, repair)
        for item, repair in zip(failing, repair_list, strict=True)
    }
    out: list[AgentToRendererMessage] = []
    for message_index, message in enumerate(processed.messages):
        msg: dict[str, Any] = message.model_dump(by_alias=True, exclude_none=True)
        changed = False
        for envelope in ("createSurface", "updateComponents"):
            body = msg.get(envelope)
            if not isinstance(body, dict):
                continue
            components = body.get("components")
            if not isinstance(components, list):
                continue
            for component_index, component in enumerate(components):
                if not isinstance(component, dict):
                    continue
                entry = by_slot.get((message_index, envelope, component_index))
                if entry is None:
                    continue
                item, repair = entry
                if (
                    repair.source == item.source
                    and repair.compiled == item.result.compiled
                ):
                    continue
                updated = {
                    **component,
                    "source": repair.source,
                }
                updated = ReactAppTransformer.fill_allowlists(updated)
                if repair.compiled is not None:
                    updated["compiled"] = repair.compiled
                else:
                    updated.pop("compiled", None)
                components[component_index] = updated
                changed = True
        out.append(to_message_models([msg])[0] if changed else message)
    return out, repair_list


def gemini_generate(
    model: str = DEFAULT_REPAIR_MODEL,
    *,
    api_key: str | None = None,
) -> Generate:
    """A `Generate` backed by the Gemini API (needs the `google-genai` package).

    Sends the repair rules and module declarations as `system_instruction`.

    Args:
        model: The model id.
        api_key: The API key; defaults to `GEMINI_API_KEY` from the environment.
    """
    from google import genai  # pylint: disable=import-outside-toplevel
    from google.genai import types  # pylint: disable=import-outside-toplevel

    client = genai.Client(api_key=api_key) if api_key else genai.Client()

    async def generate(prompt: str, system_instruction: str | None = None) -> str:
        config = (
            types.GenerateContentConfig(system_instruction=system_instruction)
            if system_instruction
            else None
        )
        response = await client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        return response.text or ""

    return generate
