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

"""Standard JSON transport format decompiler."""

import json
from typing import Any, List
from a2ui.schema.constants import A2UI_OPEN_TAG, A2UI_CLOSE_TAG


class _TransportDecompiler:
    """Private helper to decompile structured JSON payloads."""

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured JSON payload to pretty-printed JSON."""
        return json.dumps(val, indent=2)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps JSON string blocks within <a2ui-json> tags."""
        full_json = "\n".join(blocks)
        return f"{A2UI_OPEN_TAG}\n{full_json}\n{A2UI_CLOSE_TAG}"
