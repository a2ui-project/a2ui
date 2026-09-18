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

"""Headless rendering command hook for A2UI."""

from __future__ import annotations

import json
import os
import sys
from typing import Optional

from .formatters import print_error, print_success


def render_command(
    payload_path: str,
    png_out: str,
    width: int = 800,
    height: int = 600,
    catalog_id: Optional[str] = None,
) -> int:
    """Renders an A2UI payload to a PNG file using the headless render engine."""
    if not os.path.isfile(payload_path):
        print_error(f"Payload file not found: {payload_path}")
        return 1

    try:
        from a2ui.render import render_payload_to_png
    except ImportError:
        print_error(
            "A2UI Headless Rendering engine (a2ui.render) is not installed or"
            " available."
        )
        return 1

    try:
        with open(payload_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        png_bytes = render_payload_to_png(
            payload=payload,
            out_path=png_out,
            width=width,
            height=height,
            catalog_id=catalog_id,
        )
        print_success(f"Rendered {payload_path} -> {png_out} ({len(png_bytes)} bytes)")
        return 0
    except Exception as e:
        print_error(f"Rendering failed: {e}")
        return 1
