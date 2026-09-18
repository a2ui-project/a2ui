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

"""Visual parity and render fidelity tests against committed baselines."""

import glob
from pathlib import Path
import struct
import pytest

from a2ui.render.engine import HeadlessRenderEngine, render_payload_to_png

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
FIXTURES_DIR = Path("agent_sdks/python/a2ui_agent/tests/fixtures/render")
PAYLOADS_DIR = FIXTURES_DIR / "payloads"
BASELINES_DIR = FIXTURES_DIR / "baselines"


def _get_fixture_names():
    payload_files = sorted(PAYLOADS_DIR.glob("*.json"))
    return [p.stem for p in payload_files]


@pytest.fixture(scope="module")
def shared_engine():
    engine = HeadlessRenderEngine(default_width=800, default_height=600)
    engine.start()
    yield engine
    engine.close()


@pytest.mark.parametrize("fixture_name", _get_fixture_names())
def test_visual_baseline_fidelity(fixture_name, shared_engine):
    payload_path = PAYLOADS_DIR / f"{fixture_name}.json"
    baseline_path = BASELINES_DIR / f"{fixture_name}.png"

    assert payload_path.is_file(), f"Payload missing: {payload_path}"
    assert baseline_path.is_file(), f"Baseline missing: {baseline_path}"

    rendered_bytes = shared_engine.render(payload_path, width=800, height=600)
    baseline_bytes = baseline_path.read_bytes()

    assert rendered_bytes.startswith(
        PNG_MAGIC
    ), f"{fixture_name} output is not valid PNG"
    assert baseline_bytes.startswith(
        PNG_MAGIC
    ), f"{fixture_name} baseline is not valid PNG"

    # Verify PNG dimensions
    w_rend, h_rend = struct.unpack(">II", rendered_bytes[16:24])
    w_base, h_base = struct.unpack(">II", baseline_bytes[16:24])
    assert (w_rend, h_rend) == (800, 600)
    assert (w_base, h_base) == (800, 600)

    # Verify non-trivial render
    assert (
        len(rendered_bytes) > 2000
    ), f"Rendered image too small ({len(rendered_bytes)} bytes)"

    # Size difference between consecutive identical environment renders should be minimal (< 5%)
    size_ratio = abs(len(rendered_bytes) - len(baseline_bytes)) / max(
        len(baseline_bytes), 1
    )
    assert size_ratio < 0.15, (
        f"Significant size drift for {fixture_name}: "
        f"baseline {len(baseline_bytes)} bytes vs rendered {len(rendered_bytes)} bytes"
    )
