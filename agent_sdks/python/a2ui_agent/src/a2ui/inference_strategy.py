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

"""Deprecated compatibility redirect for InferenceStrategy."""

import warnings
from a2ui.inference_format import InferenceFormat as InferenceStrategy

warnings.warn(
    "a2ui.inference_strategy is deprecated and will be removed. "
    "Please import from a2ui.inference_format instead.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "InferenceStrategy",
]
