# Copyright 2026 Google LLC
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

"""E-Commerce Managed Agent Server.

Demonstrates:
1. Multi-catalog modular skill generation (`a2ui-core`, `a2ui-basic`, `a2ui-commerce`).
2. Hardcoded Product Database & Agent Tools (`search_products`, `check_inventory`).
3. Google Gemini Managed Agent API integration with modular skills.
4. Express DSL stream parsing, catalog validation, and JSON payload streaming to React client.
"""

import os
import sys
import argparse
import copy
import http.server
import socketserver
import json
import time
from typing import Any, Optional

from google import genai
from google.genai import types

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import SkillGenerator, generate_skill


# 1. Paths & Database
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SPEC_DIR = os.path.abspath(
    os.path.join(BASE_DIR, "..", "..", "..", "specification", "v1_0")
)
BASIC_CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
COMMERCE_CATALOG_PATH = os.path.join(BASE_DIR, "catalogs", "commerce_catalog.json")
OUTPUT_SKILLS_DIR = os.path.join(BASE_DIR, "skills")


PRODUCTS = [
    {
        "id": "prod_1",
        "name": "Aura Active Noise-Canceling Headphones",
        "category": "audio",
        "price": 249.99,
        "stock": 18,
        "rating": 4.8,
        "image": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500",
        "description": (
            "Premium wireless over-ear headphones with active noise cancellation and"
            " 30-hour battery life."
        ),
    },
    {
        "id": "prod_2",
        "name": "ErgoPro Wireless Mechanical Keyboard",
        "category": "peripherals",
        "price": 149.50,
        "stock": 4,
        "rating": 4.6,
        "image": "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500",
        "description": (
            "Ergonomic split mechanical keyboard with hot-swappable switches and"
            " customizable RGB lighting."
        ),
    },
    {
        "id": "prod_3",
        "name": "Clarity 4K UHD Monitor 27-inch",
        "category": "monitors",
        "price": 389.00,
        "stock": 9,
        "rating": 4.9,
        "image": "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500",
        "description": (
            "Color-accurate IPS display with USB-C 90W power delivery and ultrathin"
            " bezel design."
        ),
    },
    {
        "id": "prod_4",
        "name": "PulseFit Pro Smartwatch",
        "category": "wearables",
        "price": 179.99,
        "stock": 0,
        "rating": 4.4,
        "image": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
        "description": (
            "Advanced health tracking smartwatch with GPS, heart rate monitor, and"
            " 7-day battery life."
        ),
    },
]


# 2. Agent Tools
def search_products(
    query: str = "", category: Optional[str] = None, max_price: Optional[float] = None
) -> list[dict]:
    """Searches product database by query, category filter, or max price."""
    results = []
    q = query.lower()
    for p in PRODUCTS:
        if (
            q
            and q not in p["name"].lower()
            and q not in p["description"].lower()
            and q not in p["category"].lower()
        ):
            continue
        if category and p["category"].lower() != category.lower():
            continue
        if max_price and p["price"] > max_price:
            continue
        results.append(p)
    return results


def check_inventory(product_id: str) -> dict:
    """Checks stock availability and inventory quantity for a product."""
    for p in PRODUCTS:
        if p["id"] == product_id or p["name"].lower() == product_id.lower():
            status = (
                "in_stock"
                if p["stock"] > 5
                else ("low_stock" if p["stock"] > 0 else "out_of_stock")
            )
            return {
                "id": p["id"],
                "name": p["name"],
                "quantity": p["stock"],
                "status": status,
            }
    return {"error": "Product not found"}


# 3. Dynamic Skill Compilation
def generate_modular_skills():
    """Compiles modular skills (a2ui-core, a2ui-basic, a2ui-commerce)."""
    print("1. Compiling modular A2UI skills...")
    basic_cfg = CatalogConfig.from_path("basic", BASIC_CATALOG_PATH)
    basic_cat = A2uiCatalog.from_config(basic_cfg)

    commerce_cfg = CatalogConfig.from_path("commerce", COMMERCE_CATALOG_PATH)
    commerce_cat = A2uiCatalog.from_config(commerce_cfg)

    express_fmt = ExpressFormat(catalog=basic_cat)
    generator = SkillGenerator(express_fmt)

    skill_set = generator.generate_modular(catalogs=[basic_cat, commerce_cat])
    skills_dict = skill_set.export_to_directory(OUTPUT_SKILLS_DIR)

    print(
        f"   Generated {len(skill_set)} modular skill packages in"
        f" '{OUTPUT_SKILLS_DIR}':"
    )
    for fname in skill_set.keys():
        print(f"     - {fname}")

    # Combine skill contents into full system instruction
    combined_instructions = "\n\n".join(skills_dict.values())
    return skills_dict, combined_instructions, basic_cat, commerce_cat


def build_managed_agent_environment(skills_dict: dict[str, str]) -> dict:
    """Builds remote environment sources containing .agents/AGENTS.md and .agents/skills/."""
    sources = [{
        "type": "inline",
        "target": ".agents/AGENTS.md",
        "content": (
            "You are Apex Commerce AI Assistant. Always construct interactive user"
            " interfaces using A2UI Express DSL. Follow the modular skill rules defined"
            " under .agents/skills/."
        ),
    }]

    for fname, content in skills_dict.items():
        if "core" in fname:
            target_path = ".agents/skills/a2ui-core/SKILL.md"
        elif "basic" in fname:
            target_path = ".agents/skills/a2ui-basic/SKILL.md"
        elif "commerce" in fname:
            target_path = ".agents/skills/a2ui-commerce/SKILL.md"
        else:
            clean_name = fname.rstrip("/SKILL.md").split("/")[-1]
            target_path = f".agents/skills/{clean_name}/SKILL.md"

        sources.append({
            "type": "inline",
            "target": target_path,
            "content": content,
        })

    return {
        "type": "remote",
        "sources": sources,
    }


def query_managed_agent(
    client: genai.Client,
    prompt: str,
    session_id: Optional[str] = None,
    env_config: Optional[dict] = None,
    system_instruction: Optional[str] = None,
) -> tuple[str, str]:
    """Queries Managed Agent using client.interactions.create with antigravity-preview-05-2026."""
    print(
        "Executing Managed Agent API query ('antigravity-preview-05-2026'):"
        f" '{prompt}'..."
    )
    max_retries = 5

    kwargs: dict[str, Any] = {
        "agent": "antigravity-preview-05-2026",
        "input": prompt,
    }

    if env_config:
        kwargs["environment"] = env_config
    if session_id:
        kwargs["previous_interaction_id"] = session_id
    if system_instruction:
        kwargs["system_instruction"] = system_instruction

    for attempt in range(max_retries):
        try:
            interaction = client.interactions.create(**kwargs)
            resp_text = (
                getattr(interaction, "output_text", None) or interaction.outputs or ""
            )
            return str(resp_text), interaction.id
        except Exception as err:
            err_str = str(err).lower()
            if (
                "503" in err_str
                or "429" in err_str
                or "rate" in err_str
                or "quota" in err_str
            ) and attempt < max_retries - 1:
                wait_time = 5 * (attempt + 1)
                print(
                    "   Managed Agent API rate limit retry attempt"
                    f" {attempt+2}/{max_retries} (waiting {wait_time}s)..."
                )
                time.sleep(wait_time)
                continue
            raise err


# Global server session state
import threading

ACTIVE_MANAGED_AGENT_SESSION_ID: Optional[str] = None
BOOTSTRAP_LOCK = threading.Lock()


def main():
    global ACTIVE_MANAGED_AGENT_SESSION_ID

    parser = argparse.ArgumentParser(description="E-Commerce Managed Agent Server")
    parser.add_argument("--api-key", help="Gemini API Key")
    parser.add_argument(
        "--prompt",
        default=(
            "Show me available headphones and mechanical keyboards with prices and"
            " stock."
        ),
        help="User prompt",
    )
    parser.add_argument("--port", type=int, default=8080, help="HTTP server port")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate modular skills without calling API",
    )
    parser.add_argument(
        "--serve", action="store_true", help="Launch backend web server"
    )
    args = parser.parse_args()

    skills_dict, skills_text, basic_cat, commerce_cat = generate_modular_skills()

    if args.dry_run:
        print("\n--- Modular Skill Generation Preview ---")
        print(skills_text[:600] + "\n...")
        return

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
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    merged_schema = copy.deepcopy(basic_cat.catalog_schema)
    commerce_comps = commerce_cat.catalog_schema.get("components", {})
    merged_schema.setdefault("components", {}).update(commerce_comps)

    # Ensure all custom components are registered in $defs.anyComponent.oneOf
    one_of = (
        merged_schema.setdefault("$defs", {})
        .setdefault("anyComponent", {})
        .setdefault("oneOf", [])
    )
    existing_refs = {item.get("$ref") for item in one_of if isinstance(item, dict)}
    for comp_name in commerce_comps.keys():
        ref = f"#/components/{comp_name}"
        if ref not in existing_refs:
            one_of.append({"$ref": ref})

    combined_cat = A2uiCatalog(
        version=basic_cat.version,
        name="combined",
        catalog_schema=merged_schema,
        s2c_schema=basic_cat.s2c_schema,
        common_types_schema=basic_cat.common_types_schema,
    )
    express_fmt = ExpressFormat(
        catalog=combined_cat, version="v0.9.1", emit_create_surface=False
    )
    parser_inst = express_fmt.parser

    env_config = build_managed_agent_environment(skills_dict)

    if not args.serve:
        raw_output, session_id = query_managed_agent(
            client, args.prompt, env_config=env_config, system_instruction=skills_text
        )
        print("\n--- Managed Agent Response Output ---")
        print(raw_output)

        try:
            validated = parser_inst.compile(raw_output)
            print("\n3. Validated A2UI Payload:")
            print(json.dumps(validated, indent=2))
        except Exception as e:
            print(f"\n3. Parsing result: {e}")

    if args.serve:

        class CommerceHandler(http.server.SimpleHTTPRequestHandler):

            def do_GET(self):
                global ACTIVE_MANAGED_AGENT_SESSION_ID

                if self.path == "/api/bootstrap":
                    try:
                        with BOOTSTRAP_LOCK:
                            if ACTIVE_MANAGED_AGENT_SESSION_ID:
                                session_id = ACTIVE_MANAGED_AGENT_SESSION_ID
                                print(
                                    "   Reusing existing Managed Agent session ID:"
                                    f" {session_id}"
                                )
                            else:
                                print(
                                    "1. Bootstrapping Managed Agent"
                                    " antigravity-preview-05-2026..."
                                )
                                raw_init, session_id = query_managed_agent(
                                    client,
                                    "Initialize A2UI Commerce session.",
                                    env_config=env_config,
                                    system_instruction=skills_text,
                                )
                                ACTIVE_MANAGED_AGENT_SESSION_ID = session_id
                                print(
                                    "   Managed Agent bootstrapped with session ID:"
                                    f" {session_id}"
                                )

                        bootstrap_data = {
                            "status": "ready",
                            "model": "antigravity-preview-05-2026",
                            "session_id": session_id,
                            "steps": [
                                {
                                    "id": "catalogs",
                                    "name": "Catalog Loader",
                                    "status": "completed",
                                    "detail": (
                                        "Loaded basic & commerce catalog JSON"
                                        " definitions"
                                    ),
                                },
                                {
                                    "id": "skills",
                                    "name": "SkillGenerator",
                                    "status": "completed",
                                    "detail": (
                                        "Compiled 3 modular skill packages into"
                                        " .agents/skills/"
                                    ),
                                },
                                {
                                    "id": "agent",
                                    "name": (
                                        "Managed Agent (antigravity-preview-05-2026)"
                                    ),
                                    "status": "completed",
                                    "detail": (
                                        "Bootstrapped remote environment interaction"
                                        f" ({session_id[:16]}...)"
                                    ),
                                },
                                {
                                    "id": "tools",
                                    "name": "Tool Registry",
                                    "status": "completed",
                                    "detail": (
                                        "Registered search_products and check_inventory"
                                        " tools"
                                    ),
                                },
                            ],
                        }
                    except Exception as b_err:
                        print(f"Error bootstrapping Managed Agent: {b_err}")
                        bootstrap_data = {
                            "status": "error",
                            "model": "antigravity-preview-05-2026",
                            "error": str(b_err),
                        }

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(bootstrap_data).encode("utf-8"))
                elif self.path == "/api/skills":
                    skill_list = []
                    if os.path.exists(OUTPUT_SKILLS_DIR):
                        for root, _, files in os.walk(OUTPUT_SKILLS_DIR):
                            for file in files:
                                if file.endswith(".md"):
                                    full_p = os.path.join(root, file)
                                    rel_p = os.path.relpath(full_p, OUTPUT_SKILLS_DIR)
                                    dir_name = rel_p.split("/")[0]
                                    clean_name = (
                                        "a2ui-basic"
                                        if "basic" in rel_p
                                        else "a2ui-commerce"
                                        if "commerce" in rel_p
                                        else "a2ui-core"
                                        if "core" in rel_p
                                        else dir_name
                                    )
                                    with open(full_p, "r", encoding="utf-8") as sf:
                                        content = sf.read()
                                    skill_list.append({
                                        "name": clean_name,
                                        "path": rel_p,
                                        "content": content,
                                    })
                    # Sort skills logically: core, basic, commerce
                    skill_order = {"a2ui-core": 0, "a2ui-basic": 1, "a2ui-commerce": 2}
                    skill_list.sort(key=lambda x: skill_order.get(x["name"], 99))
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"skills": skill_list}).encode("utf-8"))
                elif self.path in ["/", "/index.html"]:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    with open(os.path.join(BASE_DIR, "index.html"), "rb") as f:
                        self.wfile.write(f.read())
                else:
                    super().do_GET()

            def do_POST(self):
                global ACTIVE_MANAGED_AGENT_SESSION_ID

                if self.path == "/api/chat":
                    length = int(self.headers.get("Content-Length", 0))
                    body = json.loads(self.rfile.read(length))
                    user_prompt = body.get("prompt", "")
                    client_session_id = (
                        body.get("session_id") or ACTIVE_MANAGED_AGENT_SESSION_ID
                    )

                    try:
                        raw_resp, new_session_id = query_managed_agent(
                            client,
                            user_prompt,
                            session_id=client_session_id,
                            env_config=env_config,
                        )
                        ACTIVE_MANAGED_AGENT_SESSION_ID = new_session_id
                        validated = parser_inst.compile(raw_resp)
                        res_data = {
                            "status": "success",
                            "raw": raw_resp,
                            "a2ui_messages": validated,
                            "session_id": new_session_id,
                            "loaded_skills": [
                                {
                                    "id": "a2ui-core",
                                    "name": "a2ui-core",
                                    "description": "Express DSL Grammar & Syntax Rules",
                                },
                                {
                                    "id": "a2ui-basic",
                                    "name": "a2ui-basic",
                                    "description": "Standard Basic Component Catalog",
                                },
                                {
                                    "id": "a2ui-commerce",
                                    "name": "a2ui-commerce",
                                    "description": (
                                        "Commerce Catalog (ProductCard, ProductGrid)"
                                    ),
                                },
                            ],
                        }
                    except Exception as err:
                        print(f"Error querying Managed Agent: {err}")
                        res_data = {"status": "error", "error": str(err)}

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(res_data).encode("utf-8"))
                else:
                    self.send_error(404, "Endpoint not found")

        class ReusableTCPServer(socketserver.ThreadingTCPServer):
            allow_reuse_address = True

        print(f"\n4. E-Commerce Backend Server running at http://localhost:{args.port}")
        with ReusableTCPServer(("", args.port), CommerceHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped.")


if __name__ == "__main__":
    main()
