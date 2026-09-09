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

from .base import (
    DEFAULT_CATALOG_COMPATIBILITY,
    SUPPORTED_PROTOCOL_VERSIONS,
    VersionAdapter,
    is_catalog_version_compatible,
)
from .v0_8 import V0Point8Adapter
from .v0_9 import V0Point9Adapter
from .v1_0 import V1Point0Adapter
from .factory import DEFAULT_PROTOCOL_VERSION, VersionAdapterFactory

__all__ = [
    "DEFAULT_CATALOG_COMPATIBILITY",
    "DEFAULT_PROTOCOL_VERSION",
    "SUPPORTED_PROTOCOL_VERSIONS",
    "VersionAdapter",
    "V0Point8Adapter",
    "V0Point9Adapter",
    "V1Point0Adapter",
    "VersionAdapterFactory",
    "is_catalog_version_compatible",
]
