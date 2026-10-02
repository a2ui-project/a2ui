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

"""Standard Direct JSON format decompiler."""

from collections.abc import Sequence
import json

from typing import Any

from a2ui.core.schema import AgentToRendererMessage


class _DirectJsonDecompiler:
    """Private helper to decompile structured JSON payloads."""

    def decompile(
        self,
        a2ui_payload: (
            Sequence[AgentToRendererMessage]
            | Sequence[dict[str, Any]]
            | dict[str, Any]
            | str
        ),
    ) -> str:
        """Decompiles a structured JSON payload to pretty-printed JSON."""
        raw_items: Sequence[Any]
        if isinstance(a2ui_payload, str):
            parsed = json.loads(a2ui_payload)
            raw_items = parsed if isinstance(parsed, list) else [parsed]
        elif isinstance(a2ui_payload, dict):
            raw_items = [a2ui_payload]
        else:
            raw_items = a2ui_payload

        return json.dumps(
            [
                item.model_dump(by_alias=True, exclude_none=True)
                if hasattr(item, "model_dump")
                else item
                for item in raw_items
            ],
            indent=2,
        )
