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

"""Internal decorator that marks a class or function as experimental.

A decorated class warns when it is instantiated and a decorated function warns
when it is called. Set the `A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS`
environment variable to `1`, `true`, `yes` or `on` to silence the warnings.
"""

from __future__ import annotations

from collections.abc import Callable
import functools
import os
from typing import Any, TypeVar, cast
import warnings

T = TypeVar("T")

SUPPRESS_ENV_VAR = "A2UI_SUPPRESS_EXPERIMENTAL_FEATURE_WARNINGS"

_MESSAGE = (
    "This feature is experimental and may change or be removed in future"
    " versions without notice. It may introduce breaking changes at any time."
)


def _is_suppressed() -> bool:
    value = os.environ.get(SUPPRESS_ENV_VAR)
    return value is not None and value.strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _warn(name: str) -> None:
    if not _is_suppressed():
        warnings.warn(
            f"[EXPERIMENTAL] {name}: {_MESSAGE}", category=UserWarning, stacklevel=3
        )


def experimental(obj: T) -> T:
    """Marks a class or function as experimental.

    Args:
      obj: The class or function to mark.

    Returns:
      The same class with a warning added to `__init__`, or a wrapper of the
      function that warns before each call.

    Raises:
      TypeError: If `obj` is neither a class nor a callable.
    """
    name = getattr(obj, "__name__", type(obj).__name__)

    if isinstance(obj, type):
        cls = cast(Any, obj)
        orig_init = cls.__init__

        @functools.wraps(orig_init)
        def new_init(self: Any, *args: Any, **kwargs: Any) -> Any:
            _warn(name)
            return orig_init(self, *args, **kwargs)

        cls.__init__ = new_init
        return obj

    if callable(obj):
        func = cast(Callable[..., Any], obj)

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            _warn(name)
            return func(*args, **kwargs)

        return cast(T, wrapper)

    raise TypeError("@experimental can only be applied to classes or callables")
