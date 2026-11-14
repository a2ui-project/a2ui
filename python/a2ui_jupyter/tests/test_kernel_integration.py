# Copyright 2026 Google LLC
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

from __future__ import annotations

from collections.abc import Callable, Iterator
import json
from pathlib import Path
from queue import Empty
import re
import time
from typing import Any

import pytest
from jupyter_client import BlockingKernelClient, KernelManager

from a2ui_jupyter import A2UISurface

_ACTION = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "kernel-surface",
        "sourceComponentId": "button",
        "timestamp": "2026-11-11T00:00:00Z",
        "context": {"answer": 42},
    },
}


@pytest.fixture
def kernel() -> Iterator[tuple[KernelManager, BlockingKernelClient]]:
    manager = KernelManager()
    manager.start_kernel()
    client = manager.blocking_client()
    client.start_channels()
    client.wait_for_ready(timeout=30)
    try:
        yield manager, client
    finally:
        client.stop_channels()
        manager.shutdown_kernel(now=True)


def _is_idle(message: dict[str, Any]) -> bool:
    return (
        message["msg_type"] == "status"
        and message["content"].get("execution_state") == "idle"
    )


def _collect_iopub(
    client: BlockingKernelClient,
    parent_id: str,
    is_last: Callable[[dict[str, Any]], bool] = _is_idle,
) -> list[dict[str, Any]]:
    deadline = time.monotonic() + 30
    messages: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        message = client.get_iopub_msg(timeout=max(0.1, deadline - time.monotonic()))
        if message["parent_header"].get("msg_id") != parent_id:
            continue
        messages.append(message)
        if is_last(message):
            return messages
    raise TimeoutError(f"Kernel execution {parent_id} did not become idle.")


def _wait_for_reply(client: BlockingKernelClient, parent_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        message = client.get_shell_msg(timeout=max(0.1, deadline - time.monotonic()))
        if message["parent_header"].get("msg_id") == parent_id:
            return message
    raise TimeoutError(f"Kernel execution {parent_id} did not return a shell reply.")


def _execute(client: BlockingKernelClient, code: str) -> list[dict[str, Any]]:
    parent_id = client.execute(code)
    messages = _collect_iopub(client, parent_id)
    reply = _wait_for_reply(client, parent_id)
    assert reply["content"]["status"] == "ok"
    return messages


def _stream_text(messages: list[dict[str, Any]]) -> str:
    return "".join(
        message["content"]["text"]
        for message in messages
        if message["msg_type"] == "stream"
    )


@pytest.mark.integration
def test_smoke_notebook_waits_for_submit_and_updates_status(
    kernel: tuple[KernelManager, BlockingKernelClient],
) -> None:
    notebook_path = Path(__file__).parents[1] / "examples/manual_smoke_test.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    form_cell = next(
        cell for cell in notebook["cells"] if cell["id"] == "create-surface"
    )
    _manager, client = kernel
    execution_id = client.execute("".join(form_cell["source"]))

    deadline = time.monotonic() + 30
    comm_id = None
    while time.monotonic() < deadline:
        message = client.get_iopub_msg(timeout=max(0.1, deadline - time.monotonic()))
        if message["parent_header"].get("msg_id") != execution_id:
            continue
        if message["msg_type"] == "display_data":
            widget = message["content"]["data"].get(
                "application/vnd.jupyter.widget-view+json"
            )
            if widget:
                comm_id = widget["model_id"]
                break
        if message["msg_type"] == "error":
            pytest.fail(str(message["content"]))
    assert comm_id is not None, "The notebook did not display a widget."

    later_execution_id = client.execute("print('LATER_CELL_RAN')")
    with pytest.raises(Empty):
        client.get_shell_msg(timeout=0.5)

    action = {
        "version": "1.0",
        "action": {
            "name": "submit",
            "surfaceId": "manual-smoke-test",
            "sourceComponentId": "submit",
            "timestamp": "2026-11-11T00:00:00Z",
            "context": {"name": "Ada"},
        },
    }
    client.session.send(
        client.shell_channel.socket,
        "comm_msg",
        content={
            "comm_id": comm_id,
            "data": {
                "method": "custom",
                "content": {"type": "a2ui", "message": action},
            },
        },
    )
    # Before ipykernel 7.4, the deferred later cell can publish an early idle
    # status for the waiting cell, so collect until its result instead.
    messages = _collect_iopub(
        client, execution_id, lambda message: message["msg_type"] == "execute_result"
    )
    assert _wait_for_reply(client, execution_id)["content"]["status"] == "ok"
    assert "'name': 'Ada'" in messages[-1]["content"]["data"]["text/plain"]
    later_messages = _collect_iopub(client, later_execution_id)
    assert _wait_for_reply(client, later_execution_id)["content"]["status"] == "ok"
    assert "LATER_CELL_RAN" in _stream_text(later_messages)
    assert any(
        message["msg_type"] == "comm_msg"
        and message["content"]["comm_id"] == comm_id
        and message["content"]["data"]
        .get("content", {})
        .get("message", {})
        .get("updateDataModel", {})
        .get("value")
        == "Submitted: Ada"
        for message in messages
    )


@pytest.mark.integration
def test_ipykernel_widget_display_and_awaited_input(
    kernel: tuple[KernelManager, BlockingKernelClient],
) -> None:
    bundle_path = Path(__file__).parents[1] / "src/a2ui_jupyter/static/widget.js"
    if not bundle_path.is_file():
        pytest.skip(
            "Build the @a2ui/jupyter widget bundle before kernel integration tests."
        )
    _manager, client = kernel

    messages = _execute(
        client,
        """
from IPython.display import display
from a2ui_jupyter import A2UISurface
surface = A2UISurface()
surface.send([
    {"version": "1.0", "createSurface": {
        "surfaceId": "kernel-surface",
        "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    }},
    {"version": "1.0", "updateComponents": {
        "surfaceId": "kernel-surface",
        "components": [{"id": "root", "component": "Text", "text": "Kernel test"}],
    }},
])
display(surface)
print("COMM_ID=" + surface.comm.comm_id)
""",
    )
    display_data = [
        data
        for message in messages
        if message["msg_type"] == "display_data"
        for data in [message["content"]["data"]]
    ]
    assert any(
        "application/vnd.jupyter.widget-view+json" in data for data in display_data
    )
    assert any(
        message["msg_type"] == "comm_open"
        and "_esm" in message["content"]["data"]["state"]
        for message in messages
    )
    comm_id_match = re.search(r"COMM_ID=([0-9a-f-]+)", _stream_text(messages))
    assert comm_id_match is not None
    comm_id = comm_id_match.group(1)

    execution_id = client.execute(
        "action = await surface.next_action(); "
        "print('ACTION=' + str(action.model_dump(by_alias=True, exclude_unset=True)))"
    )
    client.session.send(
        client.shell_channel.socket,
        "comm_msg",
        content={
            "comm_id": comm_id,
            "data": {
                "method": "custom",
                "content": {"type": "a2ui", "message": _ACTION},
            },
        },
    )
    action_output = _collect_iopub(client, execution_id)
    _wait_for_reply(client, execution_id)
    assert "ACTION=" in _stream_text(action_output)
    assert "'answer': 42" in _stream_text(action_output)

    later_execution = client.execute(
        "message = await surface.next_message(); "
        "print('MESSAGE=' + str(message.model_dump(by_alias=True, exclude_unset=True)))"
    )
    later_output = _collect_iopub(client, later_execution)
    _wait_for_reply(client, later_execution)
    assert "MESSAGE=" in _stream_text(later_output)
    assert "'answer': 42" in _stream_text(later_output)


@pytest.mark.integration
def test_cancelled_wait_and_restarted_kernel_runs_again(
    kernel: tuple[KernelManager, BlockingKernelClient],
) -> None:
    manager, client = kernel
    _execute(client, "from a2ui_jupyter import A2UISurface; surface = A2UISurface()")

    execution_id = client.execute(
        "import asyncio\n"
        "waiter = asyncio.create_task(surface.next_action())\n"
        "await asyncio.sleep(0)\n"
        "waiter.cancel()\n"
        "try:\n"
        "    await waiter\n"
        "except asyncio.CancelledError:\n"
        "    print('WAIT_CANCELLED')"
    )
    cancelled_output = _collect_iopub(client, execution_id)
    _wait_for_reply(client, execution_id)
    assert "WAIT_CANCELLED" in _stream_text(cancelled_output)

    client.stop_channels()
    manager.restart_kernel(now=True)
    client = manager.blocking_client()
    client.start_channels()
    client.wait_for_ready(timeout=30)
    output = _execute(client, "print('KERNEL_RECOVERED')")
    assert "KERNEL_RECOVERED" in _stream_text(output)
