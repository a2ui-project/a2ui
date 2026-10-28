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

"""Execution context tracking user activation and message processing state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..validation.payload_validator import ValidationConfig


@dataclass
class ExecutionContext:
    """Execution context passed through message processing and operation extraction.

    Attributes:
        is_user_activated: Whether user activation is present in the context.
        validation_config: The validation rules for this call, in place of the
            processor's own. An agent that checks its messages against a
            renderer's processor passes the rules it checks by, whatever rules
            the renderer was created with.
    """

    is_user_activated: bool = False
    validation_config: ValidationConfig | None = None
