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

"""Parser decorator expanding macro components into standard A2UI wire messages."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from a2ui.parser.parser import Parser
from a2ui.parser.response_part import ResponsePart

from a2ui.inference_formats.experimental.macros.processor import MacroProcessor


class MacroParser(Parser):
    """Parser decorator that intercepts parsed A2UI messages and expands macros.

    Wraps an underlying inference format parser (such as ExpressParser or
    ElementalParser). When the underlying parser produces A2UI wire messages
    containing macro components, MacroParser detects registered macro names,
    executes their expansion functions via MacroProcessor, and splices the
    resulting standard A2UI components into the message envelope.
    """

    def __init__(
        self,
        underlying_parser: Parser,
        processor: Optional[MacroProcessor] = None,
    ):
        """Initializes the macro parser.

        Args:
            underlying_parser: The base syntax parser producing raw A2UI messages.
            processor: The macro execution processor. If None, a new
                MacroProcessor is instantiated.
        """
        self.underlying_parser = underlying_parser
        self.processor = processor or MacroProcessor()

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks whether the input text contains recognizable format markup.

        Delegates directly to the underlying syntax parser.

        Args:
            content: Raw model output text.
            complete: Whether the content represents a completed response stream.

        Returns:
            True if the underlying parser detects format content.
        """
        return self.underlying_parser.has_format_content(content, complete=complete)

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps model response text into conversational and UI parts.

        Delegates to the underlying parser to separate format markup from
        natural language commentary.

        Args:
            content: Full or partial text from the model.

        Returns:
            List of ResponsePart objects.
        """
        return self.underlying_parser.unwrap(content)

    @property
    def supports_streaming(self) -> bool:
        """Indicates whether the underlying parser supports streaming chunks."""
        return self.underlying_parser.supports_streaming

    def decompile(self, val: Any) -> str:
        """Decompiles an A2UI component or value back into format syntax.

        Args:
            val: A component dictionary or value.

        Returns:
            String representation in the underlying format's DSL.
        """
        return self.underlying_parser.decompile(val)

    def _expand_component_list(self, components: List[Any]) -> List[Dict[str, Any]]:
        """Recursively expands any macro components found in a component list.

        Args:
            components: List of component dictionaries from an A2UI message.

        Returns:
            A new list of component dictionaries with macros expanded and
            spliced in place.
        """
        expanded: List[Dict[str, Any]] = []
        for comp in components:
            if not isinstance(comp, dict):
                expanded.append(comp)
                continue

            c_name = comp.get("component")
            c_id = comp.get("id")

            if c_name and self.processor.has_macro(c_name):
                params = {k: v for k, v in comp.items() if k not in ("component", "id")}
                try:
                    expanded_macro = self.processor.expand(
                        c_name, params, instance_id=c_id
                    )
                    # Spliced components may themselves contain macros
                    expanded.extend(self._expand_component_list(expanded_macro))
                except Exception:
                    expanded.append(comp)
            else:
                expanded.append(comp)
        return expanded

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[Dict[str, Any]]:
        """Compiles format content into A2UI wire messages with macros expanded.

        Invokes the underlying parser to compile syntax into initial A2UI
        envelopes, then traverses each message to expand any macro components.

        Args:
            format_content: DSL markup extracted from the model response.
            is_final: Whether this represents the final chunk of a stream.

        Returns:
            List of valid A2UI message dictionaries ready for transport.
        """
        raw_msgs = self.underlying_parser.compile(format_content, is_final=is_final)
        expanded_msgs: List[Dict[str, Any]] = []

        for msg in raw_msgs:
            if not isinstance(msg, dict):
                expanded_msgs.append(msg)
                continue

            if "surfaceUpdate" in msg and isinstance(msg["surfaceUpdate"], dict):
                surf = msg["surfaceUpdate"]
                comps = surf.get("components", [])
                new_msg = dict(msg)
                new_surf = dict(surf)
                new_surf["components"] = self._expand_component_list(comps)
                new_msg["surfaceUpdate"] = new_surf
                expanded_msgs.append(new_msg)

            elif "updateComponents" in msg and isinstance(
                msg["updateComponents"], dict
            ):
                upd = msg["updateComponents"]
                comps = upd.get("components", [])
                new_msg = dict(msg)
                new_upd = dict(upd)
                new_upd["components"] = self._expand_component_list(comps)
                new_msg["updateComponents"] = new_upd
                expanded_msgs.append(new_msg)

            elif (
                "createSurface" in msg
                and isinstance(msg["createSurface"], dict)
                and "components" in msg["createSurface"]
            ):
                cs = msg["createSurface"]
                comps = cs.get("components", [])
                new_msg = dict(msg)
                new_cs = dict(cs)
                new_cs["components"] = self._expand_component_list(comps)
                new_msg["createSurface"] = new_cs
                expanded_msgs.append(new_msg)

            else:
                expanded_msgs.append(msg)

        return expanded_msgs
