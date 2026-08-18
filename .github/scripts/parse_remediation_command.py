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

"""Parses recommendation index from issue comment body for automated remediation."""

import os
import re


def parse_recommendation_index(comment_body: str) -> str | None:
    """Parses /fix <num> from comment_body, ignoring any /fix <num> inside markdown quotes.

    A line or paragraph is considered a markdown quote if it starts with '>'
    (ignoring leading whitespace).

    Args:
        comment_body: The raw issue comment markdown string.

    Returns:
        The extracted recommendation index as a string, or None if no unquoted command is found.
    """
    if not comment_body:
        return None

    lines = comment_body.splitlines()
    in_quoted_paragraph = False
    in_code_block = False

    for line in lines:
        stripped = line.lstrip()
        if not stripped:
            in_quoted_paragraph = False
            continue

        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            continue

        if stripped.startswith(">"):
            in_quoted_paragraph = True
            continue

        if in_quoted_paragraph:
            continue

        match = re.search(r"(?:^|\s)/fix\s+([0-9]+)", line)
        if match:
            return match.group(1)

    return None


def main() -> None:
    comment_body = os.environ.get("COMMENT_BODY", "")
    rec_idx = parse_recommendation_index(comment_body)

    github_env = os.environ.get("GITHUB_ENV")
    github_output = os.environ.get("GITHUB_OUTPUT")

    if rec_idx:
        print(f"Parsed recommendation index: {rec_idx}")
        if github_env:
            with open(github_env, "a", encoding="utf-8") as f:
                f.write(f"RECOMMENDATION_INDEX={rec_idx}\n")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"triggered=true\nrecommendation_index={rec_idx}\n")
    else:
        print("No unquoted /fix command found in comment body. Skipping remediation.")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write("triggered=false\n")


if __name__ == "__main__":
    main()
