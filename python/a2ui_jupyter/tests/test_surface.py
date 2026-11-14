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

import asyncio
import subprocess
import sys
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
from pydantic import ValidationError

from a2ui_jupyter import A2UISurface
from a2ui_jupyter import surface as surface_module

ACTION = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "surface-1",
        "sourceComponentId": "button-1",
        "timestamp": "2026-11-11T00:00:00Z",
        "context": {"name": "Ada"},
    },
}

RENDERER_MESSAGES = [
    ACTION,
    {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": "surface-1",
            "functionCallId": "agent-call-1",
            "callFunction": {
                "@call": "lookup",
                "catalogId": "https://example.com/catalog.json",
                "args": {"query": "Ada"},
            },
        },
    },
    {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": "renderer-call-1",
            "value": "ok",
        },
    },
    {"version": "1.0", "error": {"code": "FAILED", "message": "Renderer failed."}},
]


def test_send_validates_the_full_batch_before_sending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(
        anywidget.AnyWidget,
        "send",
        lambda _widget, content, buffers=None: sent.append(content),
    )
    surface = A2UISurface()

    with pytest.raises(ValidationError):
        surface.send([
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "surface-1",
                    "catalogId": (
                        "https://a2ui.org/specification/v1_0/basic_catalog.json"
                    ),
                },
            },
            {"version": "0.9", "deleteSurface": {"surfaceId": "surface-1"}},
        ])

    assert sent == []
    assert surface.message_log == []


def test_send_logs_and_sends_valid_messages_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(
        anywidget.AnyWidget,
        "send",
        lambda _widget, content, buffers=None: sent.append(content),
    )
    surface = A2UISurface()
    messages = [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "surface-1",
                "catalogId": "https://a2ui.org/specification/v1_0/basic_catalog.json",
            },
        },
        {
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": "surface-1",
                "path": "/name",
                "value": "Ada",
            },
        },
    ]

    surface.send(messages)

    assert [entry["sequence"] for entry in surface.message_log] == [0, 1]
    assert [entry["message"] for entry in surface.message_log] == messages
    assert [content["sequence"] for content in sent] == [0, 1]
    assert [content["message"] for content in sent] == messages


def test_send_burst_syncs_the_log_once_and_display_flushes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(
        anywidget.AnyWidget,
        "send",
        lambda _widget, content, buffers=None: sent.append(content),
    )
    surface = A2UISurface()
    log_syncs: list[int] = []
    surface.observe(lambda change: log_syncs.append(len(change["new"])), "message_log")

    async def send_burst() -> None:
        surface.send({
            "version": "1.0",
            "createSurface": {
                "surfaceId": "surface-1",
                "catalogId": "https://a2ui.org/specification/v1_0/basic_catalog.json",
            },
        })
        for value in range(3):
            surface.send({
                "version": "1.0",
                "updateDataModel": {
                    "surfaceId": "surface-1",
                    "path": "/value",
                    "value": value,
                },
            })
        assert [content["sequence"] for content in sent] == [0, 1, 2, 3]
        assert log_syncs == []
        surface._repr_mimebundle_()
        assert log_syncs == [4]
        surface.send({"version": "1.0", "deleteSurface": {"surfaceId": "surface-1"}})
        await asyncio.sleep(0.3)

    asyncio.run(send_burst())

    assert log_syncs == [4, 5]
    assert [entry["sequence"] for entry in surface.message_log] == list(range(5))


@pytest.mark.parametrize("message", RENDERER_MESSAGES)
def test_all_v1_renderer_messages_reach_the_message_queue(
    message: dict[str, Any],
) -> None:
    surface = A2UISurface()

    surface._handle_frontend_message(surface, {"type": "a2ui", "message": message}, [])

    received = asyncio.run(asyncio.wait_for(surface.next_message(), timeout=0.1))
    assert received.model_dump(by_alias=True, exclude_unset=True) == message


def test_action_reaches_both_action_interfaces() -> None:
    surface = A2UISurface()
    handled: list[Any] = []
    received: list[Any] = []
    remove_message_handler = surface.on_message(handled.append)
    remove_action_handler = surface.on_action(received.append)

    surface._handle_frontend_message(surface, {"type": "a2ui", "message": ACTION}, [])

    from_message_queue = asyncio.run(
        asyncio.wait_for(surface.next_message(), timeout=0.1)
    )
    from_action_queue = asyncio.run(
        asyncio.wait_for(surface.next_action(), timeout=0.1)
    )
    assert from_message_queue == from_action_queue
    assert handled == [from_message_queue]
    assert received == [from_action_queue]

    remove_message_handler()
    remove_message_handler()
    remove_action_handler()
    remove_action_handler()


def test_invalid_or_unrelated_frontend_messages_are_rejected() -> None:
    surface = A2UISurface()

    with pytest.raises(ValueError, match="Unsupported custom message"):
        surface._handle_frontend_message(surface, {"type": "other"}, [])
    with pytest.raises(ValidationError):
        surface._handle_frontend_message(
            surface,
            {"type": "a2ui", "message": {"version": "0.9", "action": {}}},
            [],
        )


def test_package_imports_without_ipykernel() -> None:
    # JupyterLite (xeus) kernels have no IPython kernel; the package must still import.
    script = """
import sys
sys.modules["ipykernel"] = None
from a2ui_jupyter import surface as module
assert module._kernel_needs_comm_polling() is False
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


def _kernel_of(module_name: str) -> object:
    return type("Kernel", (), {"__module__": module_name})()


@pytest.mark.parametrize(
    ("kernel_module", "ipykernel_version", "expected"),
    [
        ("ipykernel.ipkernel", "6.29.5", True),
        ("ipykernel.ipkernel", "7.0.1", True),
        ("ipykernel.ipkernel", "7.4.0", False),
        # Non-ipykernel kernels never consult the ipykernel version.
        ("xeus_python.kernel", "7.2.0", False),
    ],
)
def test_comm_polling_depends_on_kernel_and_ipykernel_version(
    monkeypatch: pytest.MonkeyPatch,
    kernel_module: str,
    ipykernel_version: str,
    expected: bool,
) -> None:
    kernel = _kernel_of(kernel_module)
    monkeypatch.setattr(
        surface_module, "get_ipython", lambda: SimpleNamespace(kernel=kernel)
    )
    monkeypatch.setattr(surface_module, "version", lambda _name: ipykernel_version)

    assert surface_module._kernel_needs_comm_polling() is expected


@pytest.mark.parametrize("ipykernel_version", ["7.1.0", "7.3.1"])
def test_comm_polling_rejects_ipykernel_without_polling_or_native_dispatch(
    monkeypatch: pytest.MonkeyPatch, ipykernel_version: str
) -> None:
    kernel = _kernel_of("ipykernel.ipkernel")
    monkeypatch.setattr(
        surface_module, "get_ipython", lambda: SimpleNamespace(kernel=kernel)
    )
    monkeypatch.setattr(surface_module, "version", lambda _name: ipykernel_version)

    with pytest.raises(RuntimeError, match="cannot deliver renderer messages"):
        surface_module._kernel_needs_comm_polling()
