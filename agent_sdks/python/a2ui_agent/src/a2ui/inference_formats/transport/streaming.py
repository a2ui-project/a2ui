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

"""Deprecated stub module for a2ui.inference_formats.transport.streaming."""

import warnings
from a2ui.inference_formats.direct_json.streaming import (  # noqa: E402
    DirectJsonStreamParser,
    TransportStreamParser,
    A2uiStreamParser,
)

warnings.warn(
    "a2ui.inference_formats.transport.streaming is deprecated. "
    "Please import from a2ui.inference_formats.direct_json instead.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = ["DirectJsonStreamParser", "TransportStreamParser", "A2uiStreamParser"]
