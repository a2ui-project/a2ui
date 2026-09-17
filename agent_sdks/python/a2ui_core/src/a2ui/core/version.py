# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Version of the ``a2ui-core`` package.

The version is no longer stored here. It is derived from the
``python/a2ui-core/v*`` git tags at build time by hatch-vcs and baked into the
distribution metadata, which this module reads back. To release a new version,
see ``docs/contributing/release.md``; do not hand-edit a version string.

``UNKNOWN_VERSION`` is returned when the package is not installed, which happens
when importing straight from a source checkout.
"""

from importlib.metadata import PackageNotFoundError, version

UNKNOWN_VERSION = "0.0.0+unknown"

try:
    __version__ = version("a2ui-core")
except PackageNotFoundError:
    __version__ = UNKNOWN_VERSION

__all__ = ["__version__", "UNKNOWN_VERSION"]
