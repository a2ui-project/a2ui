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

"""Deprecated module: use a2ui.inference_formats.express.errors instead."""

import warnings
from a2ui.inference_formats.express.errors import *  # noqa: F403

warnings.warn(
    "Importing from 'a2ui.inference_formats.experimental.express.errors' is deprecated."
    " Use 'a2ui.inference_formats.express.errors' instead.",
    DeprecationWarning,
    stacklevel=2,
)
