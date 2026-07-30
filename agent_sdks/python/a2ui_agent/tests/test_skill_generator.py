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
from a2ui.skill_generator import SkillConfig, SkillGenerator
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
        assert (out_path / "lib/builder.py").exists()
        assert (out_path / "lib/emitter.py").exists()
        assert (out_path / "lib/validator.py").exists()
        assert (out_path / "runtime/bridge.py").exists()
        assert (out_path / "scripts/validate_ui.py").exists()

        skill_md = (out_path / "SKILL.md").read_text(encoding="utf-8")
        assert "name: render-ui" in skill_md
        assert "## 2. Available Catalogs & Components" in skill_md

        builder_code = (out_path / "lib/builder.py").read_text(encoding="utf-8")
        assert "class Card(Component):" in builder_code
        assert "class Button(Component):" in builder_code
        assert "class Text(Component):" in builder_code


def test_javascript_target_skill_generator_and_node_execution():
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / ".agents/skills/render-js-ui"
        config = SkillConfig(
            skill_name="render-js-ui",
            output_dir=str(out_path),
            target_language="javascript",
        )
        generator = SkillGenerator(config=config)
        generated_dir = generator.generate()

        assert os.path.exists(generated_dir)
        assert (out_path / "SKILL.md").exists()
        assert (out_path / "lib/builder.js").exists()
        assert (out_path / "lib/emitter.js").exists()
        assert (out_path / "runtime/bridge.js").exists()
        assert (out_path / "scripts/validate_ui.js").exists()

        js_builder = (out_path / "lib/builder.js").read_text(encoding="utf-8")
        assert "export class Card extends Component" in js_builder
        assert "export class Button extends Component" in js_builder


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
                target_language="javascript",
                catalogs=[travel_catalog],
                examples=[flight_msg, stay_msg]
            )
        )
        generator.generate()

        ref1 = out_path / "references/01_flight_option.js"
        ref2 = out_path / "references/02_stay_option.js"

        assert ref1.exists()
        assert ref2.exists()

        ref1_code = ref1.read_text(encoding="utf-8")
        assert "import { FlightCard } from '../lib/builder.js';" in ref1_code
        assert "new FlightCard({" in ref1_code
        assert 'airline: "Air France"' in ref1_code

        # Run Node.js execution on generated bespoke reference script
        node_res = subprocess.run(["node", str(ref1)], capture_output=True, text=True)
        assert node_res.returncode == 0
        assert "---A2UI_START---" in node_res.stdout
        assert '"airline":"Air France"' in node_res.stdout


def test_cli_interface():
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir) / ".agents/skills/cli-skill"
        cli_main(["--name", "cli-skill", "--target-language", "javascript", "--output", str(out_path)])
        assert (out_path / "SKILL.md").exists()
        assert (out_path / "lib/builder.js").exists()
