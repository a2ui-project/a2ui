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
from typing import Any, Optional

from google import genai
from google.genai import types

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import generate_skill


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
        "description": "Premium wireless over-ear headphones with active noise cancellation and 30-hour battery life."
    },
    {
        "id": "prod_2",
        "name": "ErgoPro Wireless Mechanical Keyboard",
        "category": "peripherals",
        "price": 149.50,
        "stock": 4,
        "rating": 4.6,
        "image": "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500",
        "description": "Ergonomic split mechanical keyboard with hot-swappable switches and customizable RGB lighting."
    },
    {
        "id": "prod_3",
        "name": "Clarity 4K UHD Monitor 27-inch",
        "category": "monitors",
        "price": 389.00,
        "stock": 9,
        "rating": 4.9,
        "image": "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500",
        "description": "Color-accurate IPS display with USB-C 90W power delivery and ultrathin bezel design."
    },
    {
        "id": "prod_4",
        "name": "PulseFit Pro Smartwatch",
        "category": "wearables",
        "price": 179.99,
        "stock": 0,
        "rating": 4.4,
        "image": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
        "description": "Advanced health tracking smartwatch with GPS, heart rate monitor, and 7-day battery life."
    }
]


# 2. Agent Tools
def search_products(query: str = "", category: Optional[str] = None, max_price: Optional[float] = None) -> list[dict]:
    """Searches product database by query, category filter, or max price."""
    results = []
    q = query.lower()
    for p in PRODUCTS:
        if q and q not in p["name"].lower() and q not in p["description"].lower() and q not in p["category"].lower():
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
            status = "in_stock" if p["stock"] > 5 else ("low_stock" if p["stock"] > 0 else "out_of_stock")
            return {"id": p["id"], "name": p["name"], "quantity": p["stock"], "status": status}
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

    skills = generate_skill(
        catalogs=[basic_cat, commerce_cat],
        inference_format=express_fmt,
        modular=True,
        output_dir=OUTPUT_SKILLS_DIR,
    )
    print(f"   Generated {len(skills)} modular skill packages in '{OUTPUT_SKILLS_DIR}':")
    for fname in skills.keys():
        print(f"     - {fname}")

    # Combine skill contents into full system instruction
    combined_instructions = "\n\n".join(skills.values())
    return combined_instructions, basic_cat, commerce_cat


def query_commerce_agent(client: genai.Client, system_instruction: str, prompt: str) -> str:
    """Queries Gemini Managed Agent API with modular commerce skills."""
    print(f"2. Executing Agent query: '{prompt}'...")
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
    parser = argparse.ArgumentParser(description="E-Commerce Managed Agent Server")
    parser.add_argument("--api-key", help="Gemini API Key")
    parser.add_argument("--prompt", default="Show me available headphones and mechanical keyboards with prices and stock.", help="User prompt")
    parser.add_argument("--port", type=int, default=8080, help="HTTP server port")
    parser.add_argument("--dry-run", action="store_true", help="Generate modular skills without calling API")
    parser.add_argument("--serve", action="store_true", help="Launch backend web server")
    args = parser.parse_args()

    skills_text, basic_cat, commerce_cat = generate_modular_skills()

    if args.dry_run:
        print("\n--- Modular Skill Generation Preview ---")
        print(skills_text[:600] + "\n...")
        return

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("\nError: GEMINI_API_KEY environment variable or --api-key argument is required.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    merged_schema = copy.deepcopy(basic_cat.catalog_schema)
    merged_schema.setdefault("components", {}).update(commerce_cat.catalog_schema.get("components", {}))
    combined_cat = A2uiCatalog(
        version=basic_cat.version,
        name="combined",
        catalog_schema=merged_schema,
        s2c_schema=basic_cat.s2c_schema,
        common_types_schema=basic_cat.common_types_schema,
    )
    express_fmt = ExpressFormat(catalog=combined_cat)
    parser_inst = express_fmt.parser

    if not args.serve:
        raw_output = query_commerce_agent(client, skills_text, args.prompt)
        print("\n--- Agent Response Output ---")
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

                    raw_resp = query_commerce_agent(client, skills_text, user_prompt)
                    try:
                        validated = parser_inst.compile(raw_resp)
                        res_data = {"status": "success", "raw": raw_resp, "a2ui_messages": validated}
                    except Exception as err:
                        res_data = {"status": "partial", "raw": raw_resp, "error": str(err)}

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(res_data).encode("utf-8"))

        print(f"\n4. E-Commerce Backend Server running at http://localhost:{args.port}")
        with socketserver.TCPServer(("", args.port), CommerceHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped.")


if __name__ == "__main__":
    main()
