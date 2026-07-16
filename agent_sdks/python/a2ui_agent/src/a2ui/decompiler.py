# Copyright 2026 Google LLC
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

"""Abstract decompiler interface."""

from abc import ABC, abstractmethod
from typing import Any, List


class Decompiler(ABC):
    """Abstract interface defining the A2UI decompiler."""

    @abstractmethod
    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        pass

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return "\n".join(blocks)
