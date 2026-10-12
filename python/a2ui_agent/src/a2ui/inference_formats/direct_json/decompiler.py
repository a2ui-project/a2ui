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

from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG


class DirectJsonDecompiler:
    """Decompiles structured A2UI payload messages into pretty-printed JSON."""

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles a sequence of AgentToRendererMessage objects to pretty-printed JSON."""
        dicts = to_message_dicts(a2ui_payload)
        return json.dumps(dicts, indent=2)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps JSON string blocks within <a2ui-json> tags."""
        full_json = "\n".join(blocks)
        return f"{A2UI_OPEN_TAG}\n{full_json}\n{A2UI_CLOSE_TAG}"
