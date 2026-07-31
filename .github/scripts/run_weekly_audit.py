# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Executes the Antigravity weekly compliance audit using the Google GenAI SDK."""

import os
import subprocess
import sys
import time


def extract_report_text(interaction) -> str:
    """Extracts the full report text from interaction output or steps."""
    if interaction.output_text and interaction.output_text.strip().startswith("#"):
        return interaction.output_text.strip()

    for step in reversed(getattr(interaction, "steps", None) or []):
        step_dict = step.model_dump() if hasattr(step, "model_dump") else {}
        for key in ("result", "content", "summary"):
            val = step_dict.get(key)
            if isinstance(val, str) and val.strip().startswith("#"):
                return val.strip()
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, dict) and item.get(
                        "text", ""
                    ).strip().startswith("#"):
                        return item["text"].strip()

    return ""


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    gh_token = os.environ.get("GITHUB_TOKEN")
    if not gh_token:
        raise ValueError("GITHUB_TOKEN environment variable is not configured.")

    from google import genai

    client = genai.Client(api_key=api_key)

    prompt = (
        "1. Clone the target repository: https://github.com/a2ui-project/a2ui (branch:"
        " main).\n2. Locate and read the compliance skill file at"
        " `.agents/skills/a2ui-audit/SKILL.md`.\n3. Follow all instructions in the"
        " skill file to perform an Antigravity compliance audit on the repository.\n4."
        " Publish the report as a new GitHub issue on a2ui-project/a2ui by executing:\n"
        "   python3 .agents/skills/a2ui-audit/scripts/create_compliance_report.py"
        " compliance_report.md --repo a2ui-project/a2ui\n"
    )

    print("🚀 Launching Antigravity Agent interaction...")
    interaction = client.interactions.create(
        agent="antigravity-preview-05-2026",
        input=prompt,
        background=True,
        environment={
            "type": "remote",
            "network": {
                "allowlist": [
                    {
                        "domain": "api.github.com",
                        "transform": [{"Authorization": f"Bearer {gh_token}"}],
                    },
                    {"domain": "github.com"},
                ]
            },
        },
    )

    print(f"Interaction created! ID: {interaction.id}")

    # Poll for completion with a 30-second interval
    while interaction.status in ["in_progress", "queued"]:
        time.sleep(30)
        interaction = client.interactions.get(id=interaction.id)
        print(f"Current status: {interaction.status}...")

    print("--- Audit Completed ---")
    print(interaction.output_text)

    if interaction.status != "completed":
        raise RuntimeError(f"Audit interaction ended with status: {interaction.status}")

    report_text = extract_report_text(interaction)
    if report_text:
        report_file = "compliance_report.md"
        with open(report_file, "w", encoding="utf-8") as f:
            f.write(report_text)

        script_path = os.path.join(
            ".agents", "skills", "a2ui-audit", "scripts", "create_compliance_report.py"
        )
        if os.path.exists(script_path):
            print("📢 Publishing compliance report issue to GitHub...")
            subprocess.run(
                [
                    sys.executable,
                    script_path,
                    report_file,
                    "--repo",
                    "a2ui-project/a2ui",
                ],
                check=False,
            )
        if os.path.exists(report_file):
            os.remove(report_file)


if __name__ == "__main__":
    main()
