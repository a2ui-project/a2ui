# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Constants used by A2UI Express."""


class SurfaceOperation:
  """Standard A2UI v1.0 surface operation envelope keys."""

  CREATE = "createSurface"
  DELETE = "deleteSurface"
  UPDATE_DATA = "updateDataModel"
  CALL_FUNC = "callFunction"
