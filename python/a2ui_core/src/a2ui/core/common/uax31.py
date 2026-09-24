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
"""UAX #31 identifier validation helpers for A2UI."""

from ..exceptions import A2uiCatalogError


def is_valid_uax31_identifier(name: str) -> bool:
    """Validates whether a string conforms to UAX #31 / system identifier syntax."""
    if not name or not isinstance(name, str):
        return False
    test_name = name[1:] if name.startswith("@") else name
    return test_name.isidentifier()


def assert_uax31_identifier(name: str, context: str = "identifier") -> None:
    """Asserts that a string is a valid UAX #31 identifier, raising A2uiCatalogError otherwise."""
    if not is_valid_uax31_identifier(name):
        raise A2uiCatalogError(f"Invalid UAX #31 {context}: '{name}'")


__all__ = [
    "is_valid_uax31_identifier",
    "assert_uax31_identifier",
]
