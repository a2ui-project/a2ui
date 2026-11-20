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

"""ADK `after_tool_callback` integration for `ToolPointerBinder`."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
import inspect
import logging
import re
from typing import TYPE_CHECKING, Any
import uuid

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.adk.utils.feature_decorator import experimental

from a2ui.constants import A2UI_TOOL_NAME, A2UI_VALIDATED_JSON_KEY
from a2ui.inference_formats import to_message_dicts
from a2ui.processor import A2uiRequestProcessor

from .processor_store import A2uiProcessorStore
from .send_a2ui_to_client_toolset import A2uiProcessorProvider

if TYPE_CHECKING:
    from a2ui.inference_formats.experimental.decision import ActionSpec
    from a2ui.inference_formats.experimental.decision_binder import ToolPointerBinder

logger = logging.getLogger(__name__)

_NON_IDENT_RE = re.compile(r"[^A-Za-z0-9_]+")

IntentBuilder = Callable[[BaseTool, dict[str, Any], ToolContext], str]
ActionsProvider = Callable[
    [BaseTool, dict[str, Any], ToolContext], Sequence["ActionSpec | str"]
]
AfterToolCallbackFn = Callable[
    [BaseTool, dict[str, Any], ToolContext, dict[str, Any]],
    Awaitable[dict[str, Any] | None],
]


def _sanitize_identifier(raw: str) -> str:
    """Converts `raw` into a safe identifier suffix for surface IDs."""
    cleaned = _NON_IDENT_RE.sub("_", raw).strip("_")
    return cleaned or "surface"


def _strip_untrusted_a2ui_key(
    tool_response: Any,
) -> tuple[Any, bool]:
    """Strips any untrusted `A2UI_VALIDATED_JSON_KEY` from `tool_response`."""
    if isinstance(tool_response, Mapping):
        if A2UI_VALIDATED_JSON_KEY in tool_response:
            sanitized = {
                k: v for k, v in tool_response.items() if k != A2UI_VALIDATED_JSON_KEY
            }
            return sanitized, True
        return dict(tool_response), False
    return tool_response, False


async def _resolve_processor(
    processor_store: (
        A2uiProcessorStore | A2uiRequestProcessor | A2uiProcessorProvider | None
    ),
    tool_context: ToolContext,
) -> A2uiRequestProcessor | None:
    """Resolves the session's `A2uiRequestProcessor`, if configured."""
    if processor_store is None:
        return None
    if isinstance(processor_store, A2uiRequestProcessor):
        return processor_store
    if isinstance(processor_store, A2uiProcessorStore):
        return processor_store.get(tool_context)
    resolved = processor_store(tool_context)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


def _extract_intent(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    intent_builder: IntentBuilder | None,
) -> str:
    """Builds the intent string for `ToolPointerBinder.bind_tool_output`."""
    if intent_builder is not None:
        return intent_builder(tool, args, tool_context)
    user_content = getattr(tool_context, "user_content", None)
    parts = getattr(user_content, "parts", None)
    if isinstance(parts, Sequence) and not isinstance(parts, (str, bytes)):
        texts = [
            p.text.strip()
            for p in parts
            if isinstance(getattr(p, "text", None), str) and p.text.strip()
        ]
        if texts:
            return " ".join(texts)
    description = getattr(tool, "description", None)
    if isinstance(description, str) and description.strip():
        return description.strip()
    return tool.name


def _choose_surface_id(
    prefix: str,
    tool: BaseTool,
    tool_context: ToolContext,
    processor: A2uiRequestProcessor | None,
) -> str:
    """Selects a collision-free surface ID for a bound tool output."""
    fc_id = getattr(tool_context, "function_call_id", None)
    if isinstance(fc_id, str) and fc_id.strip():
        base = f"{prefix}_{_sanitize_identifier(fc_id)}"
    else:
        base = f"{prefix}_{_sanitize_identifier(tool.name)}"
    state = processor.state if processor is not None else None
    if state is None or state.get_surface(base) is None:
        return base
    suffix = 2
    while suffix < 1000 and state.get_surface(f"{base}_{suffix}") is not None:
        suffix += 1
    if state.get_surface(f"{base}_{suffix}") is not None:
        return f"{base}_{uuid.uuid4().hex[:8]}"
    return f"{base}_{suffix}"


def _maybe_sanitized(
    sanitized_response: Any, had_untrusted_key: bool
) -> dict[str, Any] | None:
    """Returns `sanitized_response` if an untrusted key was stripped, else None."""
    if had_untrusted_key and isinstance(sanitized_response, dict):
        return sanitized_response
    return None


@dataclass(frozen=True)
class _CallbackConfig:
    """Immutable configuration captured by `make_adk_after_tool_callback`."""

    binder: ToolPointerBinder
    processor_store: (
        A2uiProcessorStore | A2uiRequestProcessor | A2uiProcessorProvider | None
    )
    allowed_set: frozenset[str] | None
    surface_id_prefix: str
    intent_builder: IntentBuilder | None
    actions_provider: ActionsProvider | None
    timeout_seconds: float | None


async def _run_after_tool_callback(
    config: _CallbackConfig,
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict[str, Any],
) -> dict[str, Any] | None:
    """Executes one `after_tool_callback` invocation with spoofing protection."""
    if tool.name == A2UI_TOOL_NAME:
        return None

    sanitized_response, had_untrusted_key = _strip_untrusted_a2ui_key(tool_response)
    if had_untrusted_key:
        logger.warning(
            "Stripped untrusted %s key from raw response of tool %r.",
            A2UI_VALIDATED_JSON_KEY,
            tool.name,
        )

    if config.allowed_set is not None and tool.name not in config.allowed_set:
        return _maybe_sanitized(sanitized_response, had_untrusted_key)

    processor = await _resolve_processor(config.processor_store, tool_context)
    if config.processor_store is not None and processor is None:
        return _maybe_sanitized(sanitized_response, had_untrusted_key)
    intent = _extract_intent(tool, args, tool_context, config.intent_builder)
    actions = (
        config.actions_provider(tool, args, tool_context)
        if config.actions_provider is not None
        else ()
    )
    surface_id = _choose_surface_id(
        config.surface_id_prefix, tool, tool_context, processor
    )

    result = await config.binder.bind_tool_output(
        intent,
        tool.name,
        sanitized_response,
        actions=actions,
        surface_id=surface_id,
        timeout_seconds=config.timeout_seconds,
    )
    if result.abstained or not result.messages:
        return _maybe_sanitized(sanitized_response, had_untrusted_key)

    if processor is not None and processor.state is not None:
        with processor.state.transaction():
            touched = processor.state.apply(result.messages)
            processor.state.check_topology(touched)

    tool_context.actions.skip_summarization = True
    return {
        A2UI_VALIDATED_JSON_KEY: to_message_dicts(result.messages),
        "tool_result": sanitized_response,
    }


@experimental
def make_adk_after_tool_callback(
    binder: ToolPointerBinder,
    *,
    processor_store: (
        A2uiProcessorStore | A2uiRequestProcessor | A2uiProcessorProvider | None
    ) = None,
    allowed_tools: Collection[str] | None = None,
    surface_id_prefix: str = "tool_surface",
    intent_builder: IntentBuilder | None = None,
    actions_provider: ActionsProvider | None = None,
    timeout_seconds: float | None = None,
) -> AfterToolCallbackFn:
    """Creates an ADK `after_tool_callback` backed by `ToolPointerBinder`.

    The callback strips any untrusted `A2UI_VALIDATED_JSON_KEY` from raw tool
    responses before binding. When `binder` matches an allowlisted tool's
    output, the callback applies the bound messages to the session processor's
    `RendererState` (when present), sets
    `tool_context.actions.skip_summarization = True`, and returns
    ``{A2UI_VALIDATED_JSON_KEY: ..., "tool_result": sanitized_tool_response}``.
    When `binder` abstains, the callback leaves `skip_summarization` untouched
    and passes through the sanitized response.

    Pair with `A2uiPartConverter(..., allowed_a2ui_tool_names=...)` (or
    `A2uiEventConverter(..., allowed_a2ui_tool_names=...)`) listing the same
    domain tool names so only callback-verified tools emit `A2uiPart` items.

    Args:
        binder: `ToolPointerBinder` instance used to bind tool outputs.
        processor_store: Optional `A2uiProcessorStore`, `A2uiRequestProcessor`,
            or provider returning the session's processor for `RendererState`
            updates.
        allowed_tools: Optional allowlist of domain tool names eligible for
            binding. When None, all tools except `send_a2ui_json_to_client`
            are eligible.
        surface_id_prefix: Prefix for generated surface IDs.
        intent_builder: Optional callable extracting intent text from
            `(tool, args, tool_context)`.
        actions_provider: Optional callable supplying turn actions from
            `(tool, args, tool_context)`.
        timeout_seconds: Optional per-call backend deadline passed to `binder`.

    Returns:
        An async ADK `after_tool_callback` function.
    """
    if isinstance(allowed_tools, (str, bytes)):
        raise TypeError(
            "allowed_tools must be a collection of tool names, not a string."
        )
    config = _CallbackConfig(
        binder=binder,
        processor_store=processor_store,
        allowed_set=frozenset(allowed_tools) if allowed_tools is not None else None,
        surface_id_prefix=surface_id_prefix,
        intent_builder=intent_builder,
        actions_provider=actions_provider,
        timeout_seconds=timeout_seconds,
    )

    async def after_tool_callback(
        tool: BaseTool,
        args: dict[str, Any],
        tool_context: ToolContext,
        tool_response: dict[str, Any],
    ) -> dict[str, Any] | None:
        return await _run_after_tool_callback(
            config, tool, args, tool_context, tool_response
        )

    return after_tool_callback
