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

"""Decision-model solver strategy for A2UI evaluation."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    DecisionFormatFactory,
    DecisionPromptGenerator,
)
from a2ui.parser.messages import to_message_dicts
from inspect_ai.model import CachePolicy, ChatMessageSystem
from inspect_ai.solver import Generate, Solver, TaskState, solver

from ..decision_common import build_decision_backend, decision_metadata
from ..runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    build_catalogs_and_examples,
    parse_and_validate,
    runner_options_from_metadata,
)
from ..shared.utils import GIT_ROOT, measured_generate
from .format import (
    _CompileResult,
    _apply_compile_result,
    assemble_system_prompt,
    retry_until_ok,
)

_SURFACE_ID_PATTERN = re.compile(
    r"['\"]surfaceId['\"]\s*:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE
)


def _find_surface_id(completion: str, allowed_surface_ids: list[str]) -> str:
    """The surface ID named in the decision block, or the first allowed one."""
    default_surface_id = allowed_surface_ids[0] if allowed_surface_ids else "main"
    match = _SURFACE_ID_PATTERN.search(completion)
    if match and match.group(1) in allowed_surface_ids:
        return match.group(1)
    return default_surface_id


def _decision_retry_prompt(error: str) -> str:
    """Builds a corrective prompt when decision block synthesis fails."""
    if "could not choose components" in error or "abstained" in error:
        return (
            "The layout engine could not choose components for this block; restate the"
            " intent and give the payload descriptive keys. Fix the decision block and"
            " reply with the complete corrected block only."
        )
    return (
        f"Validation failed: {error}. Fix the A2UI decision payload and reply with"
        " the complete corrected block only."
    )


@solver
def decision_system_prompt(version: str) -> Solver:
    """Injects system prompt instructions using the decision inference format."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:  # pylint: disable=unused-argument
        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        options = runner_options_from_metadata(state.metadata, resolved_catalog_path)

        catalogs, examples = build_catalogs_and_examples(
            resolved_catalog_path,
            version,
            options.to_dict() if options else None,
        )
        generator = DecisionPromptGenerator(
            catalogs,
            examples=examples,
            archetypes=ArchetypeGrammar.default(),
        )
        generated_snippet = generator.generate()

        full_prompt = assemble_system_prompt(state, generated_snippet, "decision")
        state.messages.insert(0, ChatMessageSystem(content=full_prompt))
        return state

    return solve


@solver
def compile_decision_payload(
    version: str,
    *,
    decision_backend: str | None = None,
    max_validation_retries: int = 0,
) -> Solver:
    """Synthesizes decision blocks into validated A2UI JSON components.

    Runs the DecisionSynthesizer on the generated decision block, validates the
    resulting A2UI messages using the Direct JSON validator, and stores the
    compiled messages and decision metadata on the task state.
    """
    measured = measured_generate()

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if not state.output or not state.output.completion:
            return state

        resolved_catalog_path = str(GIT_ROOT / state.metadata["catalog"])
        options = runner_options_from_metadata(state.metadata, resolved_catalog_path)
        allowed_surface_ids = state.metadata.get("allowed_surface_ids") or ["main"]

        catalogs, _ = build_catalogs_and_examples(
            resolved_catalog_path,
            version,
            options.to_dict() if options else None,
        )
        backend_name = (
            decision_backend or os.environ.get("A2UI_DECISION_BACKEND") or "mock"
        )
        backend = build_decision_backend(backend_name)
        factory = DecisionFormatFactory(backend=backend)
        format_obj = factory.create_format(catalogs)

        async def attempt_synthesize(completion: str) -> _CompileResult:
            surface_id = _find_surface_id(completion, allowed_surface_ids)
            parser = format_obj.create_parser()
            try:
                parsed_blocks = parser._extract_blocks(completion)  # pylint: disable=protected-access
                outputs = await parser.synthesize_blocks(
                    completion, default_surface_id=surface_id
                )
            except Exception as e:  # pylint: disable=broad-exception-caught
                return _CompileResult(error=str(e))

            if not outputs:
                return _CompileResult(error="No decision blocks produced any messages")

            meta = decision_metadata(
                outputs,
                backend_name=backend_name,
                block=parsed_blocks[0] if parsed_blocks else None,
            )
            state.metadata["decision_latency_ms"] = (
                state.metadata.get("decision_latency_ms") or 0.0
            ) + meta.get("decision_latency_ms", 0.0)
            state.metadata["decision_calls"] = (
                state.metadata.get("decision_calls") or 0
            ) + meta.get("decision_calls", 0)
            for k, v in meta.items():
                if k not in ("decision_latency_ms", "decision_calls"):
                    state.metadata[k] = v

            all_message_dicts: list[dict[str, Any]] = []
            for out in outputs:
                all_message_dicts.extend(to_message_dicts(out.messages))

            if not all_message_dicts:
                return _CompileResult(
                    error=(
                        "The layout engine could not choose components for this"
                        " block; restate the intent and give the payload descriptive"
                        " keys."
                    )
                )

            formatted = (
                f"<a2ui-json>\n{json.dumps(all_message_dicts, indent=2)}\n</a2ui-json>"
            )
            try:
                await asyncio.to_thread(
                    parse_and_validate,
                    "direct_json",
                    version,
                    resolved_catalog_path,
                    surface_id,
                    formatted,
                    DEFAULT_PARSE_TIMEOUT_SEC,
                    options=options,
                )
            except Exception as e:  # pylint: disable=broad-exception-caught
                return _CompileResult(error=str(e))

            return _CompileResult(formatted=formatted, compiled_jsons=all_message_dicts)

        try:
            result, completion, _ = await retry_until_ok(
                state,
                generate,
                attempt_synthesize,
                max_retries=max_validation_retries,
                retry_prompt=_decision_retry_prompt,
                measured=measured,
            )
            _apply_compile_result(state, result, completion)
            return state
        finally:
            await factory.aclose()

    return solve


def decision_solver(
    version: str,
    *,
    decision_backend: str | None = None,
    max_validation_retries: int = 0,
    cache: bool | CachePolicy = False,
) -> list[Solver]:
    """Assembles the solver chain for the decision inference strategy."""
    return [
        decision_system_prompt(version),
        measured_generate(cache=cache),
        compile_decision_payload(
            version,
            decision_backend=decision_backend,
            max_validation_retries=max_validation_retries,
        ),
    ]
