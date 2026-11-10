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

"""The `openUrl` function body shared by the basic catalogs. Package-internal."""

from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any

from ..common.event_loop import running_loop
from ..exceptions import A2uiUrlBlockedError
from ..security.url_security_policy import UrlCheckInfo, check_url_baseline

logger = logging.getLogger(__name__)


def execute_open_url(args: dict[str, Any], context: Any = None) -> None:
    """Opens a URL after the URL security policy allows it as `navigation`.

    The allowed URL goes to the surface's `open_url_handler` when the host set
    one. A headless core has nothing else to open it with, so without a
    handler an allowed call does nothing.

    Args:
        args: The function's arguments; `url` is the URL to open.
        context: The `DataContext` the function runs in, which supplies the
            surface's policy and handler. Without one, only the baseline
            checks apply.

    Raises:
        A2uiUrlBlockedError: If the policy blocks the URL.
    """
    url = args.get("url")
    if not isinstance(url, str) or not url:
        return None

    info = UrlCheckInfo(function_name="openUrl")
    sanitize = getattr(context, "sanitize_url", None)
    allowed = (
        sanitize(url, "navigation", info)
        if callable(sanitize)
        else check_url_baseline(url, "navigation")
    )
    surface = getattr(context, "surface", None)
    surface_id = getattr(surface, "id", None)
    if allowed is None:
        raise A2uiUrlBlockedError(
            "The URL security policy blocked the URL passed to openUrl.",
            expression="openUrl",
            surface_id=surface_id,
        )

    handler = getattr(surface, "open_url_handler", None)
    if handler is None:
        return None
    result = handler(
        allowed, UrlCheckInfo(function_name="openUrl", surface_id=surface_id)
    )
    if inspect.isawaitable(result):
        _run_in_background(result)
    return None


def _run_in_background(awaitable: Any) -> None:
    """Runs an awaitable handler result on the running loop, logging failures."""
    if running_loop() is None:
        # Off the loop nothing could drive it; run it to completion here.
        try:
            asyncio.run(_await(awaitable))
        except Exception:  # pylint: disable=broad-exception-caught
            logger.exception("The open-URL handler failed.")
        return
    task = asyncio.ensure_future(awaitable)

    def _log_failure(done: asyncio.Future[Any]) -> None:
        if not done.cancelled() and done.exception() is not None:
            logger.error("The open-URL handler failed.", exc_info=done.exception())

    task.add_done_callback(_log_failure)


async def _await(awaitable: Any) -> Any:
    return await awaitable
