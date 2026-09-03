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

"""Playwright screenshot script for E-Commerce Assistant Demo UI."""

import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOTS_DIR = os.path.join(BASE_DIR, "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def capture_screenshot(
    url: str = "http://localhost:5180", output_filename: str = "app_preview.png"
):
    """Navigates to demo app URL, submits a query, and captures a PNG screenshot."""
    target_path = os.path.join(SCREENSHOTS_DIR, output_filename)
    print(f"Connecting to demo app at {url}...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        try:
            page.goto(url, wait_until="networkidle", timeout=15000)
            time.sleep(1)

            # Click quick prompt button
            page.click("text=🔍 Search Electronics")
            print("Submitted query 'Search Electronics'...")

            # Wait for A2UI components to render on surface canvas
            time.sleep(20)

            page.screenshot(path=target_path, full_page=True)
            print(f"Successfully saved screenshot to: {target_path}")
        except Exception as e:
            print(f"Error capturing screenshot: {e}")
            sys.exit(1)
        finally:
            browser.close()


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5180"
    capture_screenshot(target_url)
