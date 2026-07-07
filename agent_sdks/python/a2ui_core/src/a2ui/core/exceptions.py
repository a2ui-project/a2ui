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

"""Custom exceptions for the A2UI SDK."""


import dataclasses


@dataclasses.dataclass(frozen=True)
class A2uiErrorDetail:
    """Represents a single structured error or diagnostic detail."""

    path: str
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return dataclasses.asdict(self)


class A2uiError(ValueError):
    """Base exception class for all A2UI SDK failures."""

    def __init__(
        self, message: str, details: list[A2uiErrorDetail] | None = None
    ) -> None:
        super().__init__(message)
        self.details = details or []


class A2uiParseError(A2uiError):
    """Exception raised when failing to parse or extract A2UI payloads."""

    pass


class A2uiValidationError(A2uiError):
    """Exception raised when A2UI payload violates schema constraints."""

    pass


class A2uiCatalogError(A2uiError):
    """Exception raised during catalog management or loading."""

    pass


class A2uiIntegrityError(A2uiError):
    """Exception raised when layout graph integrity or relationship checks fail."""

    pass


class A2uiRecursionError(A2uiError):
    """Exception raised when recursive or traversal limits are exceeded."""

    pass


class A2uiCompileError(A2uiError):
    """Exception raised when compiling or translating alternative UI formats/DSLs."""

    pass
