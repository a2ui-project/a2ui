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

"""Converts protocol versions to the bare form that URIs and paths use."""

from __future__ import annotations

from a2ui.core.schema import ProtocolVersion


def to_version_number(version: ProtocolVersion | str) -> str:
    """Returns a protocol version without its leading "v", such as `"0.9"`.

    `ProtocolVersion` values carry a leading "v" (`"v0.9"`), while A2A
    extension URIs (`.../a2ui/v0.9`), catalog definitions and many file layouts
    use the bare number. `ProtocolVersion.V0_9`, `"v0.9"` and `"0.9"` all give
    `"0.9"`. A string that isn't a `ProtocolVersion` value passes through
    without its leading "v", so versions this SDK doesn't define still work.

    Use this rather than formatting the enum: `f"{ProtocolVersion.V0_9}"` gives
    `"A2uiProtocolVersion.V0_9"`, not its value.

    Args:
        version: A `ProtocolVersion`, or a version string with or without a
            leading "v".

    Returns:
        The version without a leading "v".
    """
    text = version.value if isinstance(version, ProtocolVersion) else version
    return text.removeprefix("v")
