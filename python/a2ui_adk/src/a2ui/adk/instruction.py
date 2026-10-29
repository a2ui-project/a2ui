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

"""An ADK instruction provider that adds the A2UI prompt to an agent.

ADK reads `{name}` templates in a string `LlmAgent.instruction` and replaces
them with session state, so an A2UI prompt in that string fails on its own
braces: `KeyError: "Context variable not found: 'expression'."` for the
`${expression}` in the basic catalog, and likewise for `\\p{XID_Start}` in
the v1.0 schemas, `{true}` in Elemental's rules, and the data bindings in
the examples. ADK skips the templates when the instruction is a callable
`InstructionProvider`, which is what `A2uiInstruction` is.

Usage:

  ```python
  agent = LlmAgent(
      model="gemini-2.5-flash",
      name="restaurant_agent",
      instruction=A2uiInstruction(
          "You help the user find restaurants near {city}.",
          a2ui_processor=processor,
      ),
  )
  ```

The agent's own instruction keeps its `{city}` template, which ADK reads
from session state as it does for a string instruction. The processor's
prompt (`A2uiRequestProcessor.prompt_snippet`) is added as it is.
"""

from __future__ import annotations

import inspect
import logging

from google.adk.agents import readonly_context
from google.adk.agents.llm_agent import InstructionProvider
from google.adk.utils import instructions_utils
from google.adk.utils.feature_decorator import experimental

from a2ui.processor import A2uiRequestProcessor

from .send_a2ui_to_client_toolset import A2uiEnabledProvider, A2uiProcessorProvider

__all__ = [
    "A2uiInstruction",
]

logger = logging.getLogger(__name__)


async def _resolve_instruction(
    instruction: str | InstructionProvider,
    ctx: readonly_context.ReadonlyContext,
) -> str:
    """Resolves an instruction as ADK does for `LlmAgent.instruction`.

    A string is a template whose `{name}` placeholders are read from session
    state; a provider is called, and its result is kept as it is.
    """
    if isinstance(instruction, str):
        if not instruction:
            return ""
        return await instructions_utils.inject_session_state(instruction, ctx)
    resolved = instruction(ctx)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


@experimental
class A2uiInstruction:
    """An `InstructionProvider` that adds the A2UI prompt to an agent's instruction.

    Pass an instance as `LlmAgent.instruction`. On each request it resolves
    the agent's own instruction, and when A2UI is enabled, appends the
    processor's `prompt_snippet` to it. Because the agent's instruction is
    then a provider, ADK does not read session state templates out of the
    result, so the braces in the A2UI prompt are left alone.

    The agent's own instruction is still a template when it is a string: its
    `{name}` placeholders are read from session state, and a missing name
    raises `KeyError`, as for a string `LlmAgent.instruction`. Pass a
    provider instead to have it used as it is.
    """

    def __init__(
        self,
        instruction: str | InstructionProvider = "",
        *,
        a2ui_processor: A2uiRequestProcessor | A2uiProcessorProvider,
        a2ui_enabled: bool | A2uiEnabledProvider = True,
        fallback_instruction: str | InstructionProvider | None = None,
    ):
        """Initializes the provider.

        Args:
            instruction: The agent's own instruction: a session state template
              or an `InstructionProvider`. The A2UI prompt is appended to it.
            a2ui_processor: The request processor whose `prompt_snippet` is
              appended, or a provider that returns it per context, such as
              `A2uiProcessorStore.get`. A processor given for every request
              must not have a renderer state bound to it, since every
              conversation would share that state.
            a2ui_enabled: Whether A2UI is enabled, or a provider that decides
              it per context, such as `A2uiProcessorStore.is_enabled`.
            fallback_instruction: The instruction to use when A2UI is
              disabled, for an agent whose text-only instruction differs.
              Defaults to `instruction` without the A2UI prompt.
        """
        if (
            isinstance(a2ui_processor, A2uiRequestProcessor)
            and a2ui_processor.state is not None
        ):
            logger.warning(
                "A2uiInstruction got one processor for every request, with a"
                " RendererState bound to it: every conversation shares that"
                " state. Pass a provider that returns each conversation's"
                " processor instead."
            )
        self._instruction = instruction
        self._a2ui_processor = a2ui_processor
        self._a2ui_enabled = a2ui_enabled
        self._fallback_instruction = fallback_instruction

    async def __call__(self, ctx: readonly_context.ReadonlyContext) -> str:
        """Returns the agent's instruction with the A2UI prompt appended.

        Raises:
            KeyError: If a string instruction names session state that the
              session does not hold.
            TypeError: If A2UI is enabled and the processor provider returns
              something else than an `A2uiRequestProcessor`.
        """
        if not await self._resolve_enabled(ctx):
            fallback = self._fallback_instruction
            if fallback is None:
                fallback = self._instruction
            return await _resolve_instruction(fallback, ctx)
        instruction = await _resolve_instruction(self._instruction, ctx)
        processor = await self._resolve_processor(ctx)
        parts = [part for part in (instruction, processor.prompt_snippet) if part]
        return "\n\n".join(parts)

    async def _resolve_enabled(self, ctx: readonly_context.ReadonlyContext) -> bool:
        if isinstance(self._a2ui_enabled, bool):
            return self._a2ui_enabled
        enabled = self._a2ui_enabled(ctx)
        if inspect.isawaitable(enabled):
            enabled = await enabled
        return enabled

    async def _resolve_processor(
        self, ctx: readonly_context.ReadonlyContext
    ) -> A2uiRequestProcessor:
        if isinstance(self._a2ui_processor, A2uiRequestProcessor):
            return self._a2ui_processor
        processor = self._a2ui_processor(ctx)
        if inspect.isawaitable(processor):
            processor = await processor
        if not isinstance(processor, A2uiRequestProcessor):
            hint = (
                " A2UI is enabled for a context that has no processor."
                if processor is None
                else ""
            )
            raise TypeError(
                "A2uiInstruction expects an A2uiRequestProcessor, got"
                f" {type(processor).__name__}.{hint}"
            )
        return processor
