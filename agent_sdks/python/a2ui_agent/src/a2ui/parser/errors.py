# Copyright 2026 Google LLC
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

"""Custom exception types raised by the A2UI parser."""

from typing import Any, List, Optional


class A2uiCompilationError(Exception):
    """Exception raised when compiling/parsing an A2UI format block fails."""

    def __init__(
        self,
        message: str,
        raw_content: str,
        line: Optional[int] = None,
        column: Optional[int] = None,
        help_message: Optional[str] = None,
        partial_results: Optional[List[Any]] = None,
    ):
        super().__init__(message)
        self.raw_content = raw_content
        self.line = line
        self.column = column
        self.help_message = help_message
        self.partial_results = partial_results or []
