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
import time


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    gh_token = os.environ.get("GH_TOKEN")
    if not gh_token:
        raise ValueError("GH_TOKEN environment variable is not configured.")

    from google import genai

    client = genai.Client(api_key=api_key)

    prompt = (
        "1. Clone the target repository:"
        " https://github.com/a2ui-project/a2ui (branch: main).\n"
        "2. Locate and read the compliance skill file at"
        " `.agents/skills/a2ui-audit/SKILL.md`.\n"
        "3. Follow all instructions in the skill file to perform an"
        " Antigravity compliance audit on the repository.\n"
        "4. If any compliance violations or formatting issues are found, create"
        " a detailed GitHub Issue on a2ui-project/a2ui summarizing the"
        " findings."
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
                        "transform": {"Authorization": f"Bearer {gh_token}"},
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


if __name__ == "__main__":
    main()
