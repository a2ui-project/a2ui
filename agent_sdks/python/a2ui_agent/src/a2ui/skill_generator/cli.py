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

"""CLI interface for A2UI Skill Generator (Zero external API key dependencies)."""

import argparse
import os
import sys
from pathlib import Path
from typing import List, Optional

from .config import RuntimeProfile, SkillConfig
from .generator import SkillGenerator

# Named host contracts selectable from the command line. A profile is REQUIRED because
# guessing wrong fails silently -- the emitted module is well formed and never renders.
RUNTIME_PROFILES = {
    "antigravity-webview": RuntimeProfile.antigravity_webview,
    "code-mode": RuntimeProfile.code_mode,
}


def main(args: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="A2UI Skill Generator: Synthesizes custom .agents/skills/<name> directories."
    )
    parser.add_argument(
        "--name",
        default="render-ui",
        help="Name of the target skill (default: render-ui)",
    )
    parser.add_argument(
        "--description",
        default="Skill for rendering dynamic A2UI user interfaces in webview using component catalogs.",
        help="Description for SKILL.md frontmatter",
    )
    parser.add_argument(
        "--catalog",
        action="append",
        dest="catalogs",
        help="Path to component catalog JSON/YAML definition file (can specify multiple)",
    )
    parser.add_argument(
        "--target-language",
        default="javascript",
        choices=["python", "javascript", "js", "typescript", "ts"],
        help="Target language for generated builder DSL and references (default: javascript)",
    )
    parser.add_argument(
        "--examples",
        help="Path to directory containing example A2UI JSON payload files",
    )
    parser.add_argument(
        "--example",
        action="append",
        dest="examples_list",
        help="Example A2UI JSON message payload (file path or JSON string)",
    )
    parser.add_argument(
        "--output",
        help="Target output directory (default: .agents/skills/<name>)",
    )
    parser.add_argument(
        "--runtime",
        required=True,
        choices=sorted(RUNTIME_PROFILES),
        help="REQUIRED host contract. 'antigravity-webview': module source is shipped to a "
        "confined webview that injects h/render/invoke/emit and renders A2UI natively. "
        "'code-mode': script runs in a sandbox and a bridge scrapes markers from stdout. "
        "There is no default because the wrong choice fails silently.",
    )
    parser.add_argument(
        "--capabilities",
        help="Path to a capability catalog JSON (documents invoke()'s typed args/results)",
    )

    parsed_args = parser.parse_args(args)

    catalogs = parsed_args.catalogs or []
    examples_list = parsed_args.examples_list or []
    out_dir = parsed_args.output or f".agents/skills/{parsed_args.name}"

    config = SkillConfig(
        skill_name=parsed_args.name,
        description=parsed_args.description,
        output_dir=out_dir,
        target_language=parsed_args.target_language,
        catalogs=catalogs,
        capabilities=parsed_args.capabilities,
        examples_path=parsed_args.examples,
        examples=examples_list,
    )

    generator = SkillGenerator(config=config, runtime=RUNTIME_PROFILES[parsed_args.runtime]())
    created_path = generator.generate()

    # Report what was actually READ, not just that something was written. A catalog path that
    # does not resolve falls back to the built-in basic catalog and still succeeds, so
    # "Success" alone cannot distinguish a generated travel skill from a generic one. The
    # component names make that visible at a glance.
    components = list(generator._extract_components().keys())
    refs = sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(os.path.join(created_path, "references"))
        if not f.endswith(".md") and not f.endswith(".json")
    ) if os.path.isdir(os.path.join(created_path, "references")) else []

    print(f"Success: Skill successfully created at {created_path}")
    print(f"  runtime    : {parsed_args.runtime}")
    print(f"  components : {len(components)} -- {', '.join(components) or '(none)'}")
    print(f"  references : {len(refs)} -- {', '.join(refs) or '(none)'}")


if __name__ == "__main__":
    main()
