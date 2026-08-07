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

"""Unit and integration tests for A2UI Skill Generator."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from a2ui.skill_generator import RuntimeProfile, SkillConfig, SkillGenerator
from a2ui.skill_generator.cli import main as cli_main


def test_default_skill_generator():
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / ".agents/skills/render-ui"
        config = SkillConfig(
            skill_name="render-ui",
            output_dir=str(out_path),
        )
        generator = SkillGenerator(config=config)
        generated_dir = generator.generate()

        assert os.path.exists(generated_dir)
        assert (out_path / "SKILL.md").exists()
        assert (out_path / "runtime/a2ui-react.js").exists()
        assert (out_path / "scripts/validate_ui.mjs").exists()
        assert (out_path / "references/01_basic_reference.js").exists()
        assert (out_path / "references/index.json").exists()

        skill_md = (out_path / "SKILL.md").read_text(encoding="utf-8")
        assert "name: render-ui" in skill_md
        assert "## 3. Available components" in skill_md




def test_bespoke_a2ui_message_examples_generation():
    with tempfile.TemporaryDirectory() as tmp_dir:
        travel_catalog = {
            "catalog_id": "https://a2ui.org/catalogs/travel",
            "components": {
                "FlightCard": {
                    "description": "Flight card component",
                    "properties": {"airline": {"type": "string"}, "price": {"type": "string"}}
                },
                "StayCard": {
                    "description": "Stay card component",
                    "properties": {"title": {"type": "string"}, "nightly": {"type": "string"}}
                }
            }
        }

        flight_msg = {
            "name": "flight_option",
            "version": "0.9",
            "payload": {
                "type": "FlightCard",
                "airline": "Air France",
                "route": "SFO -> CDG",
                "price": "$920"
            }
        }
        stay_msg = {
            "name": "stay_option",
            "version": "0.9",
            "payload": {
                "type": "StayCard",
                "title": "Hilton Paris",
                "nightly": "$220"
            }
        }

        out_path = Path(tmp_dir) / ".agents/skills/render-bespoke-ui"
        generator = SkillGenerator(
            config=SkillConfig(
                skill_name="render-bespoke-ui",
                output_dir=str(out_path),
                catalogs=[travel_catalog],
                examples=[flight_msg, stay_msg]
            ),
        )
        generator.generate()

        ref1 = out_path / "references/flight_option.js"
        ref2 = out_path / "references/stay_option.js"
        ref_index = out_path / "references/index.json"

        assert ref1.exists()
        assert ref2.exists()
        assert ref_index.exists()

        ref1_code = ref1.read_text(encoding="utf-8")
        assert "async function main(input)" in ref1_code
        assert '"airline": "Air France"' in ref1_code

        index_data = json.loads(ref_index.read_text(encoding="utf-8"))
        assert "flight_option.js" in index_data
        assert "stay_option.js" in index_data


def test_cli_interface():
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / ".agents/skills/cli-skill"
        cli_main(["--name", "cli-skill", "--output", str(out_path)])
        assert (out_path / "SKILL.md").exists()
        assert (out_path / "scripts/validate_ui.mjs").exists()
        assert (out_path / "runtime/a2ui-react.js").exists()


def test_generate_fails_if_output_dir_exists():
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / ".agents/skills/render-ui"
        out_path.mkdir(parents=True, exist_ok=True)
        config = SkillConfig(
            skill_name="render-ui",
            output_dir=str(out_path),
        )
        generator = SkillGenerator(config=config)
        with pytest.raises(FileExistsError):
            generator.generate()

