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

"""Streaming text accumulator for conversational text between A2UI blocks."""

from __future__ import annotations

from .response_part import ResponsePart, TextPart

__all__ = ["TextRun"]


class TextRun:
  """Emits the text of a streamed response that lies between its blocks.

  The text between two blocks is one run. A run is emitted as it arrives,
  less the whitespace at its edges: leading whitespace is dropped at the
  start of a run, and trailing whitespace is held until more text of the run
  follows, so a run ends where its last non-blank character does, as the text
  parts of a whole response do.
  """

  def __init__(self) -> None:
    self._started = False
    self._held_space = ""

  def emit(self, parts: list[ResponsePart], text: str) -> None:
    """Emits `text` as the next piece of the run.

    Nothing is emitted for a piece that is blank; its whitespace is held for
    the next piece.
    """
    body = (text if self._started else text.lstrip()).rstrip()
    if not body:
      if self._started:
        self._held_space += text
      return
    start = 0 if self._started else text.find(body)
    parts.append(TextPart(text=f"{self._held_space}{body}"))
    self._held_space = text[start + len(body) :]
    self._started = True

  def reset(self) -> None:
    """Ends the run, as a block does; whitespace held at its end is dropped."""
    self._started = False
    self._held_space = ""
