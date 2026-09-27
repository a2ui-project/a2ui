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

"""Deprecated shim for a2ui.core.schema.client_capabilities."""

from a2ui.core._compat import reexport_all as _reexport_all, warn_moved as _warn_moved
from a2ui.core.schema.v0_9.client_capabilities import *

_warn_moved(
    "a2ui.core.schema.client_capabilities",
    "a2ui.core.schema.v0_9.client_capabilities",
)
__all__ = _reexport_all("a2ui.core.schema.v0_9.client_capabilities", globals())
