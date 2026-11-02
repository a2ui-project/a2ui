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

"""Event loop lookup shared by the RPC handler and the surface model."""

from __future__ import annotations

import asyncio
import threading

_fallback_loop: asyncio.AbstractEventLoop | None = None
_fallback_lock = threading.Lock()


def running_loop() -> asyncio.AbstractEventLoop | None:
    """Returns the event loop running in this thread, or None."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def get_or_create_event_loop() -> asyncio.AbstractEventLoop:
    """Returns the event loop that futures created now should belong to.

    That is the running loop if there is one. Otherwise it is one private
    fallback loop, shared by every caller and never run, which holds futures
    that are settled when they are created, such as cached answers, so code
    off the loop can read them. The fallback loop is never installed as a
    thread's event loop, so calling this never changes `asyncio` state.
    """
    loop = running_loop()
    if loop is not None:
        return loop
    global _fallback_loop
    with _fallback_lock:
        if _fallback_loop is None or _fallback_loop.is_closed():
            _fallback_loop = asyncio.new_event_loop()
        return _fallback_loop
