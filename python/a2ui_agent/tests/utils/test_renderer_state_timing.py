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

"""Timing tests for `a2ui.utils.RendererState`.

`apply` and `transaction` must cost what they change, not the size of the
surfaces they touch, so applying n messages to one surface takes time in
proportion to n. Copying the surface on each `apply` makes it grow with the
square of n.
"""

from __future__ import annotations

from collections.abc import Callable
import gc
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.utils import RendererState

_BASIC = BasicCatalog("0.9")
_SMALLER, _LARGER = 100, 400
# Linear growth gives a ratio near 4, quadratic growth near 16.
_MAX_RATIO = 8


def _messages(size: int) -> list[dict[str, Any]]:
    """A surface, then one message for each of `size` components."""
    return [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": "s", "catalogId": _BASIC.catalog_id},
        },
        *(
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "s",
                    "components": [{"id": f"t{i}", "component": "Text", "text": "x"}],
                },
            }
            for i in range(size)
        ),
    ]


def _apply_each(size: int, in_transaction: bool) -> Callable[[], object]:
    messages = _messages(size)

    def run() -> None:
        # The collector's full passes cost time in proportion to everything
        # the test session holds, which would hide how the state's own time
        # grows.
        gc.disable()
        try:
            state = RendererState([_BASIC])
            if in_transaction:
                with state.transaction():
                    for message in messages:
                        state.apply(message)
            else:
                for message in messages:
                    state.apply(message)
        finally:
            gc.enable()

    return run


@pytest.mark.performance
@pytest.mark.parametrize("in_transaction", [False, True])
def test_applying_messages_one_by_one_takes_linear_time(timing, in_transaction):
    timing.expect_time_ratio(
        _apply_each(_LARGER, in_transaction),
        _apply_each(_SMALLER, in_transaction),
        _MAX_RATIO,
        what=f"RendererState.apply at {_LARGER} against {_SMALLER} messages",
    )
