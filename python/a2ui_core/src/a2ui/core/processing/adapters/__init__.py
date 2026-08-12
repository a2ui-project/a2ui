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

"""A2UI Processing Version Adapters package."""

from .base import VersionAdapter as VersionAdapter
from .factory import VersionAdapterFactory as VersionAdapterFactory
from .v0_9 import VersionAdapterV09 as VersionAdapterV09
from .v1_0 import VersionAdapterV10 as VersionAdapterV10

__all__ = [
    "VersionAdapter",
    "VersionAdapterFactory",
    "VersionAdapterV09",
    "VersionAdapterV10",
]
