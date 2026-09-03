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

"""Playwright screenshot script for E-Commerce Assistant Demo UI & Inspectors."""

import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOTS_DIR = os.path.join(BASE_DIR, "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def capture_screenshots(url: str = "http://localhost:5180"):
    """Navigates to demo app, submits a query, and captures Canvas & Inspector tab screenshots."""
    print(f"Connecting to demo app at {url}...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        try:
            page.goto(url, wait_until="networkidle", timeout=15000)
            # Wait for bootstrap sequence to complete
            time.sleep(4)

            # Click quick prompt button
            page.locator("button:has-text('Search Electronics')").click()
            print("Submitted query 'Search Electronics'...")

            # Wait for A2UI components to render on surface canvas
            time.sleep(28)

            # 1. Capture Rendered Surface Canvas
            canvas_path = os.path.join(SCREENSHOTS_DIR, "app_preview.png")
            page.screenshot(path=canvas_path, full_page=True)
            print(f"Saved Rendered Canvas screenshot to: {canvas_path}")

            # 2. Capture A2UI JSON Inspector Tab
            page.get_by_text("A2UI JSON Messages").click()
            time.sleep(1)
            json_path = os.path.join(SCREENSHOTS_DIR, "json_inspector.png")
            page.screenshot(path=json_path, full_page=True)
            print(f"Saved JSON Inspector screenshot to: {json_path}")

            # 3. Capture Raw Express DSL Inspector Tab
            page.get_by_text("Raw Express DSL").click()
            time.sleep(1)
            express_path = os.path.join(SCREENSHOTS_DIR, "express_inspector.png")
            page.screenshot(path=express_path, full_page=True)
            print(f"Saved Express Inspector screenshot to: {express_path}")

            # 4. Capture Compiled Skills Inspector Tab
            page.locator("button:has-text('Generated Skills')").first.click()
            time.sleep(1)
            skills_path = os.path.join(SCREENSHOTS_DIR, "skills_inspector.png")
            page.screenshot(path=skills_path, full_page=True)
            print(f"Saved Skills Inspector screenshot to: {skills_path}")

        except Exception as e:
            print(f"Error capturing screenshots: {e}")
            sys.exit(1)
        finally:
            browser.close()


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5180"
    capture_screenshots(target_url)
