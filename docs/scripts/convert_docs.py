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

import os
import re
import argparse

# Registry for bidirectional format conversion:
#
# Key:   The MkDocs admonition type (the target for '!!! type' syntax).
# Value:
#   - emoji: Used for mapping GitHub-style emoji quotes (> ⚠️) to MkDocs.
#   - tag:   Reserved for mapping official GitHub Alert syntax (> [!WARNING]).
MAPPING = {
    "warning": {"emoji": "⚠️", "tag": "WARNING"},
    "tip": {"emoji": "💡", "tag": "TIP"},
    "info": {"emoji": "ℹ️", "tag": "NOTE"},
    "success": {"emoji": "✅", "tag": "SUCCESS"},
    "danger": {"emoji": "🚫", "tag": "CAUTION"},
    "note": {"emoji": "📝", "tag": "NOTE"},
}

# Reverse lookup: mapping emojis back to their respective MkDocs types
EMOJI_TO_TYPE = {v["emoji"]: k for k, v in MAPPING.items()}

# Emoji Pattern: Handles optional bold titles and standard emojis
EMOJI_PATTERN = r">\s*(⚠️|💡|ℹ️|✅|🚫|📝)(?:\s*\*\*(.*?)\*\*)?\s*\n((?:>\s*.*\n?)*)"

# GitHub Alert Pattern [!TYPE]
GITHUB_ALERT_PATTERN = (
    r">\s*\[\!(WARNING|TIP|NOTE|IMPORTANT|CAUTION)\]\s*\n((?:>\s*.*\n?)*)"
)

# MkDocs Pattern: Captures '!!! type "Title"' blocks
MKDOCS_PATTERN = r'!!!\s+(\w+)\s+"(.*?)"\n((?:\s{4}.*\n?)*)'


def clean_body_for_mkdocs(body_text):
    """
    Cleans blockquote content for MkDocs:
    1. Removes leading '>' markers.
    2. Strips ALL leading blank lines to close the gap with the title.
    3. Strips ALL trailing blank lines to prevent extra lines at the end.
    4. Preserves internal paragraph breaks.
    """
    # Remove leading '>' and trailing whitespace from each line
    raw_lines = [re.sub(r"^>\s?", "", line).rstrip() for line in body_text.split("\n")]

    # Find the first line with actual text (to strip leading blank lines)
    start_idx = -1
    for i, line in enumerate(raw_lines):
        if line.strip():
            start_idx = i
            break

    if start_idx == -1:
        return ""

    # Slice from the first content line
    content_lines = raw_lines[start_idx:]

    # Join lines and rstrip the entire block to remove trailing blank lines
    body = "\n".join([f"    {l}".rstrip() for l in content_lines]).rstrip()
    return body


def to_mkdocs(content):
    """Converts GitHub style to MkDocs style."""

    def emoji_replacer(match):
        emoji_char, title, raw_body = match.groups()
        adm_type = EMOJI_TO_TYPE.get(emoji_char, "note")
        body = clean_body_for_mkdocs(raw_body)
        title_val = title if title else ""
        # Return block with exactly one newline at the end
        return f'!!! {adm_type} "{title_val}"\n{body}\n'

    def alert_replacer(match):
        alert_type = match.group(1).lower()
        type_map = {"important": "info", "caution": "danger"}
        mkdocs_type = type_map.get(alert_type, alert_type)
        raw_body = match.group(2)

        first_line_match = re.search(r"^>\s*\*\*(.*?)\*\*\s*\n", raw_body)
        title = first_line_match.group(1) if first_line_match else ""
        if first_line_match:
            raw_body = raw_body[first_line_match.end() :]

        body = clean_body_for_mkdocs(raw_body)
        return f'!!! {mkdocs_type} "{title}"\n{body}\n'

    content = re.sub(EMOJI_PATTERN, emoji_replacer, content, flags=re.MULTILINE)
    content = re.sub(GITHUB_ALERT_PATTERN, alert_replacer, content, flags=re.MULTILINE)
    return content


def process_file(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    new_content = to_mkdocs(content)
    if new_content != content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"[CONVERTED] {path}")


def run_conversion():
    for root, dirs, files in os.walk("docs"):
        if any(x in root for x in ["scripts", "assets", "__pycache__"]):
            continue
        for file in files:
            if file.endswith(".md"):
                process_file(os.path.join(root, file))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="GitHub to MkDocs Markdown Admonition Converter"
    )
    args = parser.parse_args()
    run_conversion()
