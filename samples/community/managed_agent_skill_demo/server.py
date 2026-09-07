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

"""Managed Agent Skill Demo Server.

Demonstrates:
1. Generating A2UI skills dynamically via Python Agent SDK (`generate_skill`).
2. Provisioning system instructions for Google Gemini / Managed Agent API using generated skills.
3. Server-side payload parsing and validation with `ExpressParser` & `A2uiValidator`.
4. Serving interactive web UI to render generated A2UI components.
"""

import os
import sys
import argparse
import http.server
import socketserver
import json
from typing import Optional

from google import genai
from google.genai import types

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import generate_skill


# 1. Setup paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SPEC_DIR = os.path.abspath(
    os.path.join(BASE_DIR, "..", "..", "..", "specification", "v1_0")
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
OUTPUT_SKILLS_DIR = os.path.join(BASE_DIR, "skills")


def generate_agent_skills() -> str:
    """Generates A2UI skills and returns the skill system instruction content."""
    print("1. Generating A2UI skills from catalog definition...")
    cat_config = CatalogConfig.from_path("basic", CATALOG_PATH)
    catalog = A2uiCatalog.from_config(cat_config)
    express_fmt = ExpressFormat(catalog=catalog)

    skills = generate_skill(
        catalogs=[catalog],
        inference_format=express_fmt,
        output_dir=OUTPUT_SKILLS_DIR,
    )

    skill_path = os.path.join(OUTPUT_SKILLS_DIR, "a2ui", "SKILL.md")
    print(f"   Skill generated successfully at: {skill_path}")

    with open(skill_path, "r", encoding="utf-8") as f:
        return f.read()


def query_managed_agent(
    client: genai.Client, system_instruction: str, prompt: str
) -> str:
    """Queries Google Gemini Managed Agent API with skill system instructions."""
    print(f"2. Sending request to Gemini Managed Agent API: '{prompt}'...")

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.2,
    )

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=prompt,
        config=config,
    )

    return response.text or ""


def main():
    parser = argparse.ArgumentParser(description="A2UI Managed Agent Skill Demo")
    parser.add_argument(
        "--api-key", help="Gemini API Key (or set GEMINI_API_KEY env var)"
    )
    parser.add_argument(
        "--prompt",
        default="Show me a card with a header and a primary button to save changes.",
        help="User prompt to send to agent",
    )
    parser.add_argument("--port", type=int, default=8080, help="HTTP server port")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run skill generation and display prompt without calling API",
    )
    parser.add_argument(
        "--serve", action="store_true", help="Start web server on specified port"
    )
    args = parser.parse_args()

    # Step 1: Generate skills
    skill_content = generate_agent_skills()

    if args.dry_run:
        print("\n--- Dry Run Completed ---")
        print("Generated Skill Instructions Preview:")
        print(skill_content[:500] + "\n...")
        return

    # Step 2: Validate API key
    api_key = (
        args.api_key
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    if not api_key:
        print(
            "\nError: GEMINI_API_KEY environment variable or --api-key argument is"
            " required."
        )
        print("Usage: GEMINI_API_KEY='your_key' python server.py")
        sys.exit(1)

    # Step 3: Initialize Google GenAI Client
    client = genai.Client(api_key=api_key)

    # Step 4: Execute Agent Query
    agent_output = query_managed_agent(client, skill_content, args.prompt)

    print("\n--- Agent Response Output ---")
    print(agent_output)

    # Step 5: Parse and Validate Express DSL Payload
    cat_config = CatalogConfig.from_path("basic", CATALOG_PATH)
    catalog = A2uiCatalog.from_config(cat_config)
    express_fmt = ExpressFormat(catalog=catalog)
    parser_inst = express_fmt.parser

    print("\n3. Validating A2UI Express response payload server-side...")
    try:
        json_payloads = parser_inst.compile(agent_output)
        print(
            f"   Success! Parsed {len(json_payloads)} valid A2UI message envelope(s):"
        )
        print(json.dumps(json_payloads, indent=2))
    except Exception as e:
        print(f"   Note: Raw output returned. Parser message: {e}")

    if args.serve:

        class DemoHandler(http.server.SimpleHTTPRequestHandler):

            def do_GET(self):
                if self.path in ["/", "/index.html"]:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    with open(os.path.join(BASE_DIR, "index.html"), "rb") as f:
                        self.wfile.write(f.read())
                else:
                    super().do_GET()

            def do_POST(self):
                if self.path == "/api/chat":
                    length = int(self.headers.get("Content-Length", 0))
                    body = json.loads(self.rfile.read(length))
                    user_prompt = body.get("prompt", "")

                    raw_resp = query_managed_agent(client, skill_content, user_prompt)
                    try:
                        validated = parser_inst.compile(raw_resp)
                        res_data = {
                            "status": "success",
                            "raw": raw_resp,
                            "a2ui_messages": validated,
                        }
                    except Exception as err:
                        res_data = {
                            "status": "partial",
                            "raw": raw_resp,
                            "error": str(err),
                        }

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(res_data).encode("utf-8"))

        print(f"\n4. Starting web server at http://localhost:{args.port}")
        with socketserver.TCPServer(("", args.port), DemoHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped.")


if __name__ == "__main__":
    main()
