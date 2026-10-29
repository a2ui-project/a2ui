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

"""Custom exceptions for the A2UI SDK."""

import dataclasses
import enum
import re


@dataclasses.dataclass(frozen=True)
class A2uiErrorDetail:
    """Represents a single structured error or diagnostic detail."""

    path: str
    code: str
    message: str
    surface_id: str | None = None

    def to_dict(self) -> dict[str, str]:
        res = {"path": self.path, "code": self.code, "message": self.message}
        if self.surface_id is not None:
            res["surfaceId"] = self.surface_id
        return res


_PASSTHROUGH_DETAIL_CODES = frozenset({
    "UNALLOWED_PARENT",
    "UNALLOWED_CHILD",
    "INVALID_FUNCTION_CALL",
    "INVALID_RESERVED_KEY",
})


class A2uiError(ValueError):
    """Base exception class for all A2UI SDK failures."""

    DEFAULT_CODE: str | None = None

    def __init__(
        self,
        message: str,
        details: list[A2uiErrorDetail] | None = None,
        *,
        code: str | None = None,
        path: str | None = None,
        surface_id: str | None = None,
        function_call_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message: str = message
        self.details: list[A2uiErrorDetail] = details or []
        first_detail = self.details[0] if self.details else None
        resolved_code = code
        if resolved_code is None:
            if first_detail and first_detail.code in _PASSTHROUGH_DETAIL_CODES:
                resolved_code = first_detail.code
            else:
                resolved_code = self.DEFAULT_CODE
        self.code: str | None = resolved_code
        self.path: str | None = (
            path
            if path is not None
            else (first_detail.path if first_detail and first_detail.path else None)
        )
        self.surface_id: str | None = (
            surface_id
            if surface_id is not None
            else (first_detail.surface_id if first_detail else None)
        )
        self.function_call_id: str | None = function_call_id


class A2uiParseError(A2uiError):
    """Exception raised when failing to parse or extract A2UI payloads."""


class A2uiValidationError(A2uiError):
    """Exception raised when A2UI payload violates schema constraints."""

    DEFAULT_CODE = "VALIDATION_FAILED"


class A2uiCatalogError(A2uiError):
    """Exception raised during catalog management or loading."""

    DEFAULT_CODE = "CATALOG_NOT_FOUND"


class A2uiStateError(A2uiError):
    """Exception raised for UI tree structural errors."""

    DEFAULT_CODE = "STATE_ERROR"


class A2uiIntegrityError(A2uiValidationError):
    """Exception raised when layout graph integrity or relationship checks fail."""

    DEFAULT_CODE = "INTEGRITY_ERROR"


class A2uiRecursionError(A2uiValidationError):
    """Exception raised when recursive or traversal limits are exceeded."""

    DEFAULT_CODE = "RECURSION_LIMIT_EXCEEDED"


class A2uiDataError(A2uiError):
    """Exception raised when accessing or mutating data model with invalid paths or types."""

    DEFAULT_CODE = "DATA_ERROR"

    def __init__(
        self,
        message: str,
        path: str | None = None,
        details: list[A2uiErrorDetail] | None = None,
        *,
        code: str | None = None,
        surface_id: str | None = None,
        function_call_id: str | None = None,
    ) -> None:
        super().__init__(
            message,
            details=details,
            code=code,
            path=path,
            surface_id=surface_id,
            function_call_id=function_call_id,
        )


class A2uiExpressionError(A2uiError):
    """Exception raised when parsing or evaluating expressions and functions."""

    DEFAULT_CODE = "EXPRESSION_ERROR"

    def __init__(
        self,
        message: str,
        details: list[A2uiErrorDetail] | None = None,
        *,
        expression: str | None = None,
        code: str | None = None,
        path: str | None = None,
        surface_id: str | None = None,
        function_call_id: str | None = None,
    ) -> None:
        super().__init__(
            message,
            details=details,
            code=code,
            path=path,
            surface_id=surface_id,
            function_call_id=function_call_id,
        )
        self.expression = expression


class RpcErrorCode(str, enum.Enum):
    """RPC error codes matching A2UI protocol specification."""

    INVALID_FUNCTION_CALL = "INVALID_FUNCTION_CALL"
    EXECUTION_ERROR = "EXECUTION_ERROR"
    UNKNOWN_FUNCTION = "UNKNOWN_FUNCTION"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
    CANCELLED = "CANCELLED"
    TIMEOUT = "TIMEOUT"
    DISPOSED = "DISPOSED"
    NO_LISTENER = "NO_LISTENER"
    DUPLICATE = "DUPLICATE"


class A2uiRpcError(A2uiError):
    """Exception raised when an RPC function execution fails."""

    def __init__(
        self,
        message: str | RpcErrorCode,
        code: str | RpcErrorCode = RpcErrorCode.UNKNOWN_ERROR,
        function_call_id: str | None = None,
        details: list[A2uiErrorDetail] | None = None,
    ) -> None:
        code_str = code.value if isinstance(code, RpcErrorCode) else str(code)
        msg_str = message.value if isinstance(message, RpcErrorCode) else str(message)
        is_first_known_code = msg_str in RpcErrorCode._value2member_map_
        is_second_like_message = bool(re.search(r"[a-z\s]", code_str)) or code_str == ""
        if is_first_known_code and is_second_like_message:
            msg_str, code_str = code_str, msg_str
        super().__init__(msg_str, details=details)
        self.code: str = code_str
        self.function_call_id: str | None = function_call_id
