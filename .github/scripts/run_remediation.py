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

"""Executes an automated remediation PR creation using the Google GenAI SDK."""

import inspect
import os
import sys
import time


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not configured.")

    gh_token = os.environ.get("GITHUB_TOKEN")
    if not gh_token:
        raise ValueError("GITHUB_TOKEN environment variable is not configured.")

    issue_num = os.environ.get("ISSUE_NUMBER")
    if not issue_num:
        raise ValueError("ISSUE_NUMBER environment variable is not configured.")

    rec_idx = os.environ.get("RECOMMENDATION_INDEX")
    if not rec_idx:
        raise ValueError("RECOMMENDATION_INDEX environment variable is not configured.")

    from google import genai  # type: ignore[import-not-found]

    client = genai.Client(api_key=api_key)
    ref_name = os.environ.get("GITHUB_REF_NAME", "main")

    prompt = inspect.cleandoc(f"""
        1. Clone the target repository: https://github.com/a2ui-project/a2ui (branch: {ref_name}).
        2. In your terminal sessions, export the required environment variables:
           export ISSUE_NUMBER="{issue_num}"
           export RECOMMENDATION_INDEX="{rec_idx}"
           export GITHUB_TOKEN='{gh_token}'
           export GH_TOKEN='{gh_token}'
        3. Read and follow all instructions in `.agents/skills/a2ui-audit/references/remediate-problem.md` to remediate recommendation #{rec_idx} from issue #{issue_num} and submit a Draft Pull Request.
        """)

    print(
        f"🚀 Launching Antigravity Agent interaction for Issue #{issue_num}"
        f" Item #{rec_idx}..."
    )
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
                    {
                        "domain": "github.com",
                        "transform": [{"Authorization": f"Bearer {gh_token}"}],
                    },
                ]
            },
        },
    )

    print(f"Interaction created! ID: {interaction.id}")

    # Poll for completion with a 30-second interval (max 60 minutes)
    max_attempts = 120
    attempts = 0
    consecutive_failures = 0
    max_consecutive_failures = 20
    while interaction.status in ["in_progress", "queued"]:
        if attempts >= max_attempts:
            raise TimeoutError("Remediation interaction timed out after 60 minutes.")
        time.sleep(30)
        attempts += 1
        try:
            interaction = client.interactions.get(id=interaction.id)
            consecutive_failures = 0
            print(f"Current status: {interaction.status}...")
        except Exception as err:
            consecutive_failures += 1
            print(
                "Transient error fetching interaction status"
                f" ({consecutive_failures}/{max_consecutive_failures}): {err}"
            )
            if consecutive_failures >= max_consecutive_failures:
                raise RuntimeError(
                    f"Failed to fetch interaction status {max_consecutive_failures}"
                    f" consecutive times: {err}"
                ) from err

    print("--- Remediation Completed ---")
    print(interaction.output_text)

    if interaction.status != "completed":
        raise RuntimeError(
            f"Remediation interaction ended with status: {interaction.status}"
        )


if __name__ == "__main__":
    main()
