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

"""Event loop lookup shared by the RPC handler and the surface model."""

from __future__ import annotations

import asyncio
import warnings


def get_or_create_event_loop() -> asyncio.AbstractEventLoop:
    """Returns the event loop that futures created now should belong to.

    That is the running loop if there is one, else the open loop set for the
    current thread. When there is neither, as on a worker thread or after
    `asyncio.run()` has closed its loop, a new loop is created and set for
    the thread.
    """
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        pass
    try:
        with warnings.catch_warnings():
            # The policy API is deprecated from Python 3.14, but it is the
            # only way to read the current thread's loop without creating one
            # on every supported version.
            warnings.simplefilter("ignore", DeprecationWarning)
            loop = asyncio.get_event_loop_policy().get_event_loop()
        if not loop.is_closed():
            return loop
    except RuntimeError:
        pass
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop
