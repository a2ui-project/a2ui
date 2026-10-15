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

"""Python Agent SDK bridge implementation."""

from __future__ import annotations

import multiprocessing
from multiprocessing.connection import Connection
import traceback
from typing import Any

from a2ui.core import (
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
)
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.parser import A2uiPart, TextPart
from a2ui.processor import CatalogConfig

from .base import AgentSdkBridge, validate_sdk_format


def get_python_strategy(
    format_name: str,
    version: str,
    catalog_config: CatalogConfig,
    surface_id: str = "main",
) -> InferenceFormat:
    """Resolves and instantiates the Python InferenceFormat strategy."""
    catalog = catalog_config.transformed_catalog
    if format_name == "direct_json":
        return DirectJsonFormat([catalog])

    formatted_version = f"v{version}" if not version.startswith("v") else version
    if format_name == "express":
        from a2ui.inference_formats.express import ExpressFormat

        return ExpressFormat(
            [catalog], surface_id=surface_id, version=formatted_version
        )
    if format_name == "elemental":
        from a2ui.inference_formats.experimental.elemental import ElementalFormat

        return ElementalFormat([catalog], surface_id=surface_id)
    if format_name == "atom":
        from a2ui.inference_formats.experimental.atom import AtomFormat

        return AtomFormat([catalog], surface_id=surface_id)

    raise ValueError(f"Unknown format strategy: {format_name}")


def parse_and_validate_in_process(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    require_complete_tags: bool = False,
) -> dict[str, Any]:
    """Parses and validates an LLM response in the current Python process."""
    catalog_config = CatalogConfig.from_path(
        resolved_catalog_path, protocol_version=version
    )
    strategy = get_python_strategy(
        format_name,
        version,
        catalog_config,
        surface_id=surface_id,
    )
    catalogs = getattr(strategy, "catalogs", [catalog_config.transformed_catalog])
    parser = strategy.create_parser()

    if require_complete_tags and not parser.has_format_content(
        completion, complete=True
    ):
        if format_name == "direct_json":
            raise ValueError(
                "A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response."
            )
        raise ValueError("A2UI tags '<a2ui>' and '</a2ui>' not found in response.")

    parts = parser.parse_response(completion)
    compiled_jsons: list[dict[str, Any]] = []
    serialized_parts: list[dict[str, Any]] = []
    for p in parts:
        if isinstance(p, TextPart):
            serialized_parts.append({"text": p.text, "a2ui_json": None})
        elif isinstance(p, A2uiPart):
            msgs = to_message_dicts(p.a2ui)
            serialized_parts.append({"text": "", "a2ui_json": msgs})
            compiled_jsons.extend(msgs)

    if not compiled_jsons:
        if format_name == "direct_json":
            raise ValueError("No A2UI JSON found in response (tags missing or empty)")
        raise ValueError(
            f"No compiled A2UI {format_name} user interface found in parsed parts."
        )

    MessageProcessor(
        list(catalogs),
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    ).process_messages(compiled_jsons)
    return {"compiled_jsons": compiled_jsons, "parts": serialized_parts}


def _process_target_wrapper(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    require_complete_tags: bool,
    conn: Connection,
) -> None:
    try:
        res = parse_and_validate_in_process(
            format_name,
            version,
            resolved_catalog_path,
            surface_id,
            completion,
            require_complete_tags=require_complete_tags,
        )
        conn.send({"result": res})
    except Exception as e:  # pylint: disable=broad-exception-caught
        conn.send({"error": f"{e}\n{traceback.format_exc()}"})
    finally:
        conn.close()


def parse_with_hard_kill_timeout(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    timeout_sec: float = 5.0,
    require_complete_tags: bool = False,
) -> dict[str, Any]:
    """Runs Python parsing and validation in a child process with a hard kill timeout."""
    ctx: Any = multiprocessing.get_context("spawn")
    parent_conn, child_conn = ctx.Pipe(duplex=False)
    p = ctx.Process(
        target=_process_target_wrapper,
        args=(
            format_name,
            version,
            resolved_catalog_path,
            surface_id,
            completion,
            require_complete_tags,
            child_conn,
        ),
    )
    p.start()
    child_conn.close()
    try:
        p.join(timeout=timeout_sec)
        if p.is_alive():
            p.kill()
            p.join()
            raise TimeoutError(
                f"Format compilation timed out after {timeout_sec}s and"
                " process was killed."
            )

        return_dict = parent_conn.recv() if parent_conn.poll() else {}
    finally:
        parent_conn.close()

    if "error" in return_dict:
        raise ValueError(return_dict["error"])
    if "result" not in return_dict:
        raise ValueError("Compilation produced no output.")
    return dict(return_dict["result"])


class PythonSdkBridge(AgentSdkBridge):
    """Bridge for the Python A2UI Agent SDK (python/a2ui_agent)."""

    sdk_name = "python"

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
    ) -> str:
        validate_sdk_format(self.sdk_name, format_name)
        catalog_config = CatalogConfig.from_path(
            resolved_catalog_path, protocol_version=version
        )
        strategy = get_python_strategy(
            format_name, version, catalog_config, surface_id=surface_id
        )
        return strategy.prompt_generator.generate()

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = 5.0,
        require_complete_tags: bool = False,
    ) -> dict[str, Any]:
        validate_sdk_format(self.sdk_name, format_name)
        if timeout_sec > 0:
            return parse_with_hard_kill_timeout(
                format_name=format_name,
                version=version,
                resolved_catalog_path=resolved_catalog_path,
                surface_id=surface_id,
                completion=completion,
                timeout_sec=timeout_sec,
                require_complete_tags=require_complete_tags,
            )
        return parse_and_validate_in_process(
            format_name=format_name,
            version=version,
            resolved_catalog_path=resolved_catalog_path,
            surface_id=surface_id,
            completion=completion,
            require_complete_tags=require_complete_tags,
        )
