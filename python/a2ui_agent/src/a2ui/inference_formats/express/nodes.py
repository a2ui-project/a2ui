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

"""AST node types produced by the A2UI Express visitor.

Literals are plain Python values: strings, numbers, booleans, None, lists for
arrays, and dicts for maps. Every other construct is a node type of its own,
so a map literal is never mistaken for a reference, whatever its keys are.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PathNode:
    """A data path such as `$/user/name`, holding the text after the `$`."""

    path: str


@dataclass(frozen=True)
class VariableNode:
    """A reference to a variable assigned in the same block."""

    name: str


@dataclass(frozen=True)
class SkippedNode:
    """The `_` placeholder that skips a positional argument."""


@dataclass(frozen=True)
class CallNode:
    """A component or function call such as `Text("Hi", variant="h1")`."""

    name: str
    args: list[Any] = field(default_factory=list)
    kwargs: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CheckNode:
    """A check such as `?required` or `?length(min=1)`."""

    name: str
    args: list[Any] = field(default_factory=list)
