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

"""Checks a running agent over A2A, in streaming and non-streaming mode.

Each mode sends a question and an A2UI action, collects the A2UI messages of
each response, and checks that they:

1. create one surface that mixes the two catalogs: its default catalog is the
   basic catalog, and some of its components name the dashboard catalog in
   their own `catalogId`, and
2. pass `validate_payload` against both catalogs, the way a renderer that holds
   them would check them.

In streaming mode it also checks that the UI arrived in more than one event.
Start the agent with `uv run .` first.
"""

import json
import sys
from typing import Any
import uuid

import click
import httpx

from a2ui.a2a import get_a2ui_extension_uri
from a2ui.utils import validate_payload
from agent_executor import RENDERER_CAPABILITIES_KEY
from prompt_builder import VERSION, build_generator

_GENERATOR = build_generator()
_CATALOGS = [c.transformed_catalog for c in _GENERATOR.catalogs]
_CATALOG_IDS = [c.catalog_id for c in _CATALOGS]


def _message(parts: list[dict[str, Any]], context_id: str, streaming: bool) -> dict:
    return {
        "messageId": str(uuid.uuid4()),
        "contextId": context_id,
        "role": "user",
        "kind": "message",
        "parts": parts,
        "metadata": {
            RENDERER_CAPABILITIES_KEY: {
                VERSION.value: {"supportedCatalogIds": _CATALOG_IDS}
            },
            "useStreaming": streaming,
        },
    }


def _a2ui_messages(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages = []
    for part in parts:
        if part.get("kind") != "data":
            continue
        data = part["data"]
        messages.extend(data if isinstance(data, list) else [data])
    return messages


def _send(client: httpx.Client, url: str, message: dict) -> tuple[list[dict], int]:
    """Sends with message/send. Returns the A2UI messages and the event count."""
    response = client.post(
        url,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "message/send",
            "params": {"message": message},
        },
    )
    response.raise_for_status()
    body = response.json()
    if "error" in body:
        raise RuntimeError(body["error"])
    parts = body["result"]["status"]["message"]["parts"]
    return _a2ui_messages(parts), 1


def _stream(client: httpx.Client, url: str, message: dict) -> tuple[list[dict], int]:
    """Sends with message/stream. Returns the A2UI messages and the event count."""
    messages: list[dict] = []
    events_with_ui = 0
    with client.stream(
        "POST",
        url,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "message/stream",
            "params": {"message": message},
        },
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            body = json.loads(line[len("data:") :])
            if "error" in body:
                raise RuntimeError(body["error"])
            result = body["result"]
            status_message = (result.get("status") or {}).get("message") or {}
            found = _a2ui_messages(status_message.get("parts", []))
            if found:
                events_with_ui += 1
                messages.extend(found)
    return messages, events_with_ui


def _check(name: str, messages: list[dict], events: int, streaming: bool) -> None:
    default_catalogs = {
        m["createSurface"]["surfaceId"]: m["createSurface"]["catalogId"]
        for m in messages
        if "createSurface" in m
    }
    # The catalog each component type resolves to: its own `catalogId`, or its
    # surface's default catalog.
    resolved: dict[str, set[str]] = {}
    for m in messages:
        update = m.get("updateComponents")
        if not update:
            continue
        default = default_catalogs.get(update["surfaceId"])
        for component in update["components"]:
            catalog_id = component.get("catalogId", default)
            resolved.setdefault(catalog_id, set()).add(component["component"])
    print(f"  {name}: {len(messages)} A2UI messages in {events} events")
    print(f"    surfaces and their default catalogs: {default_catalogs}")
    for catalog_id, types in resolved.items():
        print(f"    components on {catalog_id}: {sorted(types)}")
    if len(default_catalogs) != 1:
        raise AssertionError(f"{name}: expected one surface, got {default_catalogs}")
    missing = set(_CATALOG_IDS) - set(resolved)
    if missing:
        raise AssertionError(f"{name}: no component on {sorted(missing)}")
    validate_payload(_CATALOGS, messages)
    if streaming and events < 2:
        raise AssertionError(f"{name}: the UI arrived in {events} event, not streamed")
    print("    OK: one surface mixes both catalogs, valid")


@click.command()
@click.option("--url", default="http://localhost:10010")
@click.option("--region", default="Europe")
def main(url: str, region: str) -> None:
    headers = {"X-A2A-Extensions": get_a2ui_extension_uri(VERSION)}
    failures = 0
    with httpx.Client(headers=headers, timeout=300) as client:
        for streaming in (False, True):
            mode = "streaming" if streaming else "non-streaming"
            send = _stream if streaming else _send
            context_id = str(uuid.uuid4())
            print(f"[{mode}]")
            question = _message(
                [{"kind": "text", "text": f"Show me the sales dashboard for {region}"}],
                context_id,
                streaming,
            )
            action = _message(
                [{
                    "kind": "data",
                    "data": {
                        "version": VERSION.value,
                        "action": {
                            "name": "refresh_dashboard",
                            "surfaceId": "dashboard",
                            "sourceComponentId": "refresh_button",
                            "timestamp": "2026-01-01T00:00:00Z",
                            "context": {"region": "Asia Pacific"},
                        },
                    },
                }],
                context_id,
                streaming,
            )
            for name, message in (("question", question), ("action", action)):
                try:
                    _check(name, *send(client, url, message), streaming)
                except Exception as e:  # pylint: disable=broad-exception-caught
                    failures += 1
                    print(f"    FAILED: {e}")
    if failures:
        print(f"{failures} checks failed")
        sys.exit(1)
    print("All checks passed")


if __name__ == "__main__":
    main()
