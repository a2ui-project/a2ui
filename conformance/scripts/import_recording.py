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

"""Turns a recording of a live run into a hub scenario.

Two recordings are understood:

- A chunk recording, written by the Flutter example's recording client:
  `{request, requests, replies, format, protocolVersion, model}`, where each
  reply is the list of chunks the model streamed. The chunks are parsed with
  the agent SDK, so the scenario holds both `modelChunks` and `expectWire`.
  A request that carries the renderer's `a2ui` messages becomes the previous
  turn's `expectOutbound`.
- A wire recording, written by the restaurant finder's session test:
  `{turns: [{userText, messages}]}`, where the messages are the A2UI
  envelopes the client received. The scenario holds `expectWire` only.

Either scenario's outcome, as `e2e_outcome.outcome_of` computes it, compares
with the golden scenario's through `compare_e2e_outcome.py`.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

import yaml

from a2ui.core import Catalog
from a2ui.inference_formats import DirectJsonFormat, to_message_dicts
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart, TextPart
from a2ui.utils import RendererState

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_CATALOG_PATHS = {
    "1.0": ["catalogs/basic/v1/catalog.json"],
    "v0.9": ["specification/v0_9_1/catalogs/basic/catalog.json"],
}

# Values the renderer picks at run time, which a golden cannot pin.
_WILDCARD_KEYS = frozenset({"timestamp", "functionCallId"})


class RecordingError(ValueError):
    """A recording that cannot be turned into a scenario."""


def _protocol_version(raw: str | None) -> str:
    """The hub's name for a protocol version: `1.0`, or `v0.9` for any v0.9.x."""
    if raw is None:
        return "1.0"
    normalized = raw.lstrip("v")
    if normalized.startswith("0.9"):
        return "v0.9"
    if normalized.startswith("1.0"):
        return "1.0"
    raise RecordingError(f"Unsupported protocol version: {raw!r}")


def _load_catalogs(paths: list[str]) -> list[Catalog]:
    return [
        Catalog.from_json(json.loads((REPO_ROOT / path).read_text(encoding="utf-8")))
        for path in paths
    ]


def _make_parser(format_name: str, catalogs: list[Catalog], version: str) -> Any:
    if format_name == "direct_json":
        return DirectJsonFormat(catalogs=catalogs).create_parser()
    if format_name == "express":
        return ExpressFormat(catalogs=catalogs, version=version).create_parser()
    raise RecordingError(f"Unsupported inference format: {format_name!r}")


def _parse_chunks(parser: Any, state: RendererState, chunks: list[str]) -> list[dict]:
    """The wire parts of one reply, with adjacent text parts merged."""
    stream = parser.open_stream(state=state)
    parts: list[Any] = []
    for chunk in chunks:
        parts.extend(stream.feed(chunk))
    parts.extend(stream.close())

    wire: list[dict[str, Any]] = []
    for part in parts:
        if isinstance(part, TextPart):
            if wire and "text" in wire[-1]:
                wire[-1]["text"] += part.text
            else:
                wire.append({"text": part.text})
        elif isinstance(part, A2uiPart):
            wire.append({"a2ui": to_message_dicts(part.a2ui)})
        else:
            raise RecordingError(f"The reply could not be read: {part!r}")
    return wire


def _wildcard_renderer_values(value: Any) -> Any:
    """Replaces the values the renderer picks with `{"$match": "any"}`."""
    if isinstance(value, dict):
        return {
            key: {"$match": "any"}
            if key in _WILDCARD_KEYS
            else _wildcard_renderer_values(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_wildcard_renderer_values(item) for item in value]
    return value


def _split_request(text: str) -> tuple[str | None, list[dict] | None]:
    """Splits a recorded user turn into the typed text and the outbound messages.

    The example app sends an action or error turn as JSON whose `a2ui` holds
    the renderer's messages, and a typed turn as the text, followed by the
    renderer data model as JSON after a blank line once a surface asks for it.
    """
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get("a2ui"), dict):
            return None, list(payload["a2ui"].get("messages", []))
    head, _, tail = text.rpartition("\n\n")
    if head and tail.lstrip().startswith("{"):
        try:
            json.loads(tail)
        except json.JSONDecodeError:
            pass
        else:
            return head, None
    return text, None


def _scenario_name(path: Path) -> str:
    name = path.name
    for suffix in (".wire.json", ".json"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return path.stem


def _source(path: Path, kind_details: dict[str, Any]) -> dict[str, Any]:
    recorded_at = datetime.fromtimestamp(
        path.stat().st_mtime, tz=timezone.utc
    ).isoformat(timespec="seconds")
    source: dict[str, Any] = {"kind": "recorded", "from": str(path)}
    source.update(kind_details)
    source["recordedAt"] = recorded_at
    return source


def import_chunk_recording(
    path: str | Path, *, name: str | None = None
) -> dict[str, Any]:
    """Builds a hub scenario from a chunk recording at `path`.

    The scenario is named `name`, or after the file. `compare_e2e_outcome.py`
    pairs a recorded scenario with the golden one by name.

    Raises:
      RecordingError: If the recording has no replies, names a format or
        protocol version the importer does not know, or holds a reply the
        agent SDK cannot read.
    """
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    replies = data.get("replies") or []
    if not replies:
        raise RecordingError(f"{path} holds no replies")
    format_name = data.get("format", "direct_json")
    version = _protocol_version(data.get("protocolVersion"))
    catalog_paths = _CATALOG_PATHS[version]
    parser = _make_parser(format_name, _load_catalogs(catalog_paths), version)
    state = RendererState(parser.catalogs)

    requests = list(data.get("requests") or [])
    if not requests and data.get("request") is not None:
        requests = [data["request"]]

    turns: list[dict[str, Any]] = []
    for index, chunks in enumerate(replies):
        user_text: str | None = None
        outbound: list[dict] | None = None
        if index < len(requests):
            user_text, outbound = _split_request(requests[index])
        if outbound is not None:
            if not turns:
                raise RecordingError(
                    f"{path}: the first request already carries renderer messages"
                )
            turns[-1]["expectOutbound"] = _wildcard_renderer_values(outbound)
        turns.append(
            {
                "userText": user_text,
                "modelChunks": {format_name: list(chunks)},
                "expectWire": _parse_chunks(parser, state, list(chunks)),
            }
        )

    return {
        "name": name or _scenario_name(path),
        "action": "e2e_scenario",
        "description": f"Recorded run of {_scenario_name(path)}.",
        "protocolVersion": version,
        "catalogPaths": catalog_paths,
        "formats": [format_name],
        "source": _source(path, {"model": data.get("model", "unknown")}),
        "turns": turns,
    }


def import_wire_recording(
    path: str | Path, *, name: str | None = None
) -> dict[str, Any]:
    """Builds a hub scenario, with `expectWire` only, from a wire recording.

    The scenario is named `name`, or after the file.

    Raises:
      RecordingError: If the recording has no turns, or its messages name a
        protocol version the importer does not know.
    """
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    recorded_turns = data.get("turns") or []
    if not recorded_turns:
        raise RecordingError(f"{path} holds no turns")

    versions = {
        str(message.get("version"))
        for turn in recorded_turns
        for message in turn.get("messages", [])
        if isinstance(message, dict) and message.get("version") is not None
    }
    version = _protocol_version(next(iter(sorted(versions)), None))
    turns = [
        {
            "userText": turn.get("userText"),
            "modelChunks": {},
            "expectWire": [{"a2ui": list(turn.get("messages", []))}]
            if turn.get("messages")
            else [],
        }
        for turn in recorded_turns
    ]
    return {
        "name": name or _scenario_name(path),
        "action": "e2e_scenario",
        "description": f"Recorded run of {_scenario_name(path)}.",
        "protocolVersion": version,
        "catalogPaths": _CATALOG_PATHS[version],
        "formats": [],
        "source": _source(path, {"model": data.get("model", "unknown")}),
        "turns": turns,
    }


def import_recording(path: str | Path, *, name: str | None = None) -> dict[str, Any]:
    """Imports `path` as a wire recording if its name ends in `.wire.json`,
    and as a chunk recording otherwise."""
    path = Path(path)
    if path.name.endswith(".wire.json"):
        return import_wire_recording(path, name=name)
    return import_chunk_recording(path, name=name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Turn a recording of a live run into a hub scenario YAML."
    )
    parser.add_argument("--input", required=True, help="The recording JSON.")
    parser.add_argument("--output", required=True, help="The scenario YAML.")
    parser.add_argument(
        "--name",
        help=(
            "The scenario name, which compare_e2e_outcome.py pairs with the"
            " golden's. Defaults to the recording's file name."
        ),
    )
    args = parser.parse_args(argv)

    try:
        scenario = import_recording(args.input, name=args.name)
    except (OSError, ValueError) as error:
        print(f"Could not import {args.input}: {error}", file=sys.stderr)
        return 1

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        yaml.safe_dump([scenario], sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
