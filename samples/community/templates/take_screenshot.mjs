/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {chromium} from 'playwright';
import path from 'path';

async function capture() {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});

  await page.goto('http://localhost:5173', {waitUntil: 'networkidle'});

  // Click preset "👥 Team Roster" to show rich layout
  const btn = page.locator('button:has-text("👥 Team Roster")');
  await btn.click();
  await page.waitForTimeout(1000);

  const screenshotPath = '/tmp/a2ui_templates_screenshot.png';
  await page.screenshot({path: screenshotPath, fullPage: true});
  console.log(`📸 Screenshot saved to ${screenshotPath}`);

  await browser.close();
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
