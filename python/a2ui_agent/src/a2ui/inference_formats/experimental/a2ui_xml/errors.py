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

"""Exception classes and strict-law diagnostics for A2UI A2UI XML."""

from __future__ import annotations

from dataclasses import dataclass

from a2ui.core import A2uiError, A2uiParseError, A2uiValidationError
from a2ui.core.schema import AgentToRendererMessage


class A2uiXmlError(A2uiError):
    """Base class for all A2UI A2UI XML compilation and decompilation errors."""


class A2uiXmlParseError(A2uiXmlError, A2uiParseError):
    """Raised when A2UI XML markup or inline expressions have invalid syntax."""


class A2uiXmlValidationError(A2uiXmlError, A2uiValidationError):
    """Raised when A2UI XML constructs violate catalog schemas or protocol rules."""


@dataclass(frozen=True)
class A2uiXmlStrictViolation:
    """Records a single violation of the Six Laws of A2UI XML recovered leniently.

    Attributes:
      law: Short identifier of the violated A2UI XML rule (e.g. ``"law2_verticality"``
        or ``"law5_double_quotes"``).
      message: Human-readable explanation of the syntax violation.
      line: 1-based line number inside the A2UI XML block where the violation occurred,
        when known.
    """

    law: str
    message: str
    line: int | None = None


@dataclass(frozen=True)
class A2uiXmlCompileDiagnostics:
    """Compilation result paired with strict A2UI XML Six-Laws diagnostics.

    Attributes:
      messages: Compiled and validated A2UI protocol messages.
      strict_violations: Any Six-Laws violations recovered during lenient parsing.
    """

    messages: list[AgentToRendererMessage]
    strict_violations: tuple[A2uiXmlStrictViolation, ...] = ()

    @property
    def strict_valid(self) -> bool:
        """True when zero Six-Laws violations occurred and compilation succeeded."""
        return not self.strict_violations

    @property
    def lenient_valid(self) -> bool:
        """True because this diagnostics object represents a valid compilation."""
        return True
