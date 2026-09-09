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

from dataclasses import dataclass


@dataclass
class ExecutionContext:
    """Execution context passed through message processing and operation extraction."""

    is_user_activated: bool = False

    def __init__(
        self,
        is_user_activated: bool = False,
        user_activation_present: bool | None = None,
    ) -> None:
        if user_activation_present is not None:
            self.is_user_activated = user_activation_present
        else:
            self.is_user_activated = is_user_activated

    @property
    def user_activation_present(self) -> bool:
        """Backward compatibility alias for is_user_activated."""
        return self.is_user_activated

    @user_activation_present.setter
    def user_activation_present(self, value: bool) -> None:
        self.is_user_activated = value
