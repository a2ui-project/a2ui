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

"""Starts the scripted test agent: `python -m a2ui_e2e_agent --format express`."""

from __future__ import annotations

import logging
from pathlib import Path

import click
from starlette.middleware.cors import CORSMiddleware
import uvicorn

from .server import DEFAULT_SCENARIO_DIR, FORMATS, ServerConfig, build_app

logging.basicConfig(level=logging.INFO)


@click.command()
@click.option("--host", default="localhost", show_default=True)
@click.option("--port", default=10010, show_default=True, type=int)
@click.option(
    "--format",
    "format_name",
    default="direct_json",
    show_default=True,
    type=click.Choice(sorted(FORMATS)),
    help="The inference format the model streams and the parser reads.",
)
@click.option(
    "--scenario-dir",
    default=str(DEFAULT_SCENARIO_DIR),
    show_default=True,
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    help="The directory of e2e scenario YAML files to serve.",
)
@click.option(
    "--chunk-delay-ms",
    default=0,
    show_default=True,
    type=int,
    help="The pause before each streamed model chunk.",
)
@click.option(
    "--rpc-delay-ms",
    default=0,
    show_default=True,
    type=int,
    help="How long the lookupPrice agent function takes to answer.",
)
def main(
    host: str,
    port: int,
    format_name: str,
    scenario_dir: Path,
    chunk_delay_ms: int,
    rpc_delay_ms: int,
) -> None:
    """Serves the e2e scenarios over A2A with a scripted model."""
    config = ServerConfig(
        host=host,
        port=port,
        format=format_name,
        scenario_dir=scenario_dir,
        chunk_delay_ms=chunk_delay_ms,
        rpc_delay_ms=rpc_delay_ms,
    )
    app = build_app(config)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://localhost:\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
