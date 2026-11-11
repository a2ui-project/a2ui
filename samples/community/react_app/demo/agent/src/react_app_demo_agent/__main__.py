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

"""Runs the demo agent: `uv run react-app-demo-agent [--replay DIR | --record FILE]`."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import sys
from typing import Any

import uvicorn

from .model import DEFAULT_MODEL, GeminiModel, ModelClient, RecordingModel, ReplayModel
from .server import create_app


class JsonFormatter(logging.Formatter):
    """Writes each record as one JSON line, merging the record's `json` extra."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": round(record.created, 3),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload = getattr(record, "json", None)
        if isinstance(payload, dict):
            entry.update(payload)
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def _configure_logging(log_file: str | None) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if log_file:
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    for handler in handlers:
        handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=handlers, force=True)


def _model(args: argparse.Namespace) -> ModelClient:
    if args.replay:
        return ReplayModel(Path(args.replay), speed=args.replay_speed)
    model: ModelClient = GeminiModel(
        args.model,
        api_key=os.environ.get("GEMINI_API_KEY"),
        thinking_level=args.thinking_level or None,
    )
    if args.record:
        model = RecordingModel(model, Path(args.record))
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--host", default=os.environ.get("DEMO_AGENT_HOST", "127.0.0.1")
    )
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("DEMO_AGENT_PORT", "8787"))
    )
    parser.add_argument("--model", default=os.environ.get("DEMO_MODEL", DEFAULT_MODEL))
    parser.add_argument(
        "--thinking-level", default=os.environ.get("DEMO_THINKING_LEVEL", "low")
    )
    parser.add_argument(
        "--replay",
        default=os.environ.get("DEMO_REPLAY_DIR"),
        help=(
            "Replay recorded responses from this directory instead of calling the"
            " model."
        ),
    )
    parser.add_argument(
        "--replay-speed",
        type=float,
        default=float(os.environ.get("DEMO_REPLAY_SPEED", "1")),
    )
    parser.add_argument(
        "--record",
        default=os.environ.get("DEMO_RECORD_FILE"),
        help="Save every live response to this JSON file, for --replay.",
    )
    parser.add_argument("--log-file", default=os.environ.get("DEMO_LOG_FILE"))
    args = parser.parse_args()
    _configure_logging(args.log_file)
    uvicorn.run(
        create_app(_model(args)), host=args.host, port=args.port, log_config=None
    )


if __name__ == "__main__":
    main()
