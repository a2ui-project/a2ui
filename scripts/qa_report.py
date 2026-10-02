#!/usr/bin/env python3
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
#
# QA Report Script to validate A2UI samples against latest specification.

import os
import sys
import json
from datetime import datetime
from pathlib import Path
import traceback

# Ensure we can import agent_sdks
ROOT_DIR = Path(__file__).parent.parent.resolve()
PYTHON_SDK_DIR = ROOT_DIR / "agent_sdks" / "python" / "src"
if str(PYTHON_SDK_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_SDK_DIR))

from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.constants import VERSION_0_9


def run_validation():
    print(f"Starting QA Validation against A2UI v{VERSION_0_9}...")
    
    reports_dir = ROOT_DIR / "qa_reports"
    reports_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = reports_dir / f"report_{timestamp}.md"
    
    report_content = [
        f"# A2UI Periodic QA Report",
        f"**Date:** {datetime.now().isoformat()}",
        f"**Specification Version:** {VERSION_0_9}",
        "",
        "## Validated Samples",
        ""
    ]
    
    samples_base = ROOT_DIR / "samples" / "agent" / "adk"
    
    samples_to_test = [
        {
            "name": "custom-components-example (Contact Manager)",
            "path": samples_base / "custom-components-example",
            "catalogs_func": lambda: [
                CatalogConfig.from_path(
                    name="inline",
                    catalog_path="inline_catalog_0.9.json",
                    examples_path="examples/0.9"
                ),
                BasicCatalog.get_config(version=VERSION_0_9)
            ],
            "examples_path": "examples/0.9"
        },
        {
            "name": "restaurant_finder",
            "path": samples_base / "restaurant_finder",
            "catalogs_func": lambda: [BasicCatalog.get_config(version=VERSION_0_9)],
            "examples_path": "examples/0.9"
        }
    ]
    
    total_examples = 0
    passed_examples = 0
    failed_examples = []

    for sample in samples_to_test:
        sample_name = sample["name"]
        sample_dir = sample["path"]
        
        print(f"Validating sample: {sample_name}")
        report_content.append(f"### {sample_name}")
        
        if not sample_dir.exists():
            err = f"Error: Sample directory {sample_dir} does not exist."
            print(err)
            report_content.append(f"- ❌ {err}")
            continue
            
        os.chdir(sample_dir)
        try:
            catalogs = sample["catalogs_func"]()
            manager = A2uiSchemaManager(
                VERSION_0_9,
                catalogs=catalogs,
                accepts_inline_catalogs=True,
                schema_modifiers=[remove_strict_validation]
            )
            
            examples_dir = sample_dir / sample["examples_path"]
            if not examples_dir.exists():
                err = f"Examples dir {examples_dir} not found."
                print(err)
                report_content.append(f"- ❌ {err}")
                continue
                
            # We validate against the FIRST catalog (or inline merged)
            catalog = manager.get_selected_catalog()
            
            for filename in sorted(os.listdir(examples_dir)):
                filepath = examples_dir / filename
                if not filepath.is_file() or not filename.endswith(".json"):
                    continue
                total_examples += 1
                
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    catalog.validator.validate(data)
                    report_content.append(f"- ✅ `{filename}`: Passed")
                    passed_examples += 1
                except Exception as e:
                    err_msg = getattr(e, 'message', str(e))
                    err_str = str(err_msg).replace('\n', ' ')
                    report_content.append(f"- ❌ `{filename}`: Failed ({err_str})")
                    failed_examples.append(f"{sample_name}/{filename}")
                    
        except Exception as e:
            err = f"Error setting up schema manager: {e}"
            print(err)
            traceback.print_exc()
            report_content.append(f"- ❌ {err}")
            
        report_content.append("")

    # Summary section
    report_content.append("## Summary")
    report_content.append(f"- **Total Examples Validated:** {total_examples}")
    report_content.append(f"- **Passed:** {passed_examples}")
    report_content.append(f"- **Failed:** {len(failed_examples)}")
    
    report_str = "\n".join(report_content)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_str)
        
    print(f"\nQA Report generated at: {report_path}")
    
    if failed_examples:
        print(f"Validation finished with {len(failed_examples)} failures.")
        sys.exit(1)
    else:
        print("Validation finished successfully.")
        sys.exit(0)


if __name__ == "__main__":
    run_validation()
