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

"""A2UI Multi-Version Schema Module."""

from enum import Enum

from . import v0_9
from .v0_9 import *


class A2uiProtocolVersion(str, Enum):
    V0_9 = "v0.9"
    V0_9_1 = "v0.9.1"
    V1_0 = "v1.0"
