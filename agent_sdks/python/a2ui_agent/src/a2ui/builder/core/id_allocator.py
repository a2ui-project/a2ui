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

"""Deterministic ID allocator for generated component subtrees."""

from typing import Optional


class IdAllocator:
    """Deterministic allocator generating scoped component IDs."""

    def __init__(self, scope_prefix: str = "c"):
        self.scope_prefix = scope_prefix
        self.counters: dict[str, int] = {}

    def allocate(self, component_name: str, preferred_id: Optional[str] = None) -> str:
        if preferred_id:
            return f"{self.scope_prefix}__{preferred_id}"
        prefix = component_name.lower()
        self.counters[prefix] = self.counters.get(prefix, 0) + 1
        return f"{self.scope_prefix}__{prefix}_{self.counters[prefix]}"
