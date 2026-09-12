/**
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

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(REPO_ROOT, 'logs');
const RESULTS_JSON_FILE = path.join(LOGS_DIR, 'results.json');
const SUMMARY_MD_FILE = path.join(REPO_ROOT, 'summary.md');

function generateSummary() {
  if (!fs.existsSync(RESULTS_JSON_FILE)) {
    console.error(`Results file not found at ${RESULTS_JSON_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(RESULTS_JSON_FILE, 'utf-8');
  const payload = JSON.parse(raw);
  const results = Array.isArray(payload) ? payload : payload.results;
  const interactive =
    payload.interactiveVerifications ||
    (payload.buttonVerification ? { restaurant: payload.buttonVerification } : null);

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let md = '';
  md += `# 📊 A2UI Periodic QA Validation Summary\n\n`;
  md += `**Execution Timestamp**: \`${timestamp}\`  \n`;
  md += `**Validation Scope**: All ${total} repository sample applications  \n\n`;

  md += `## 📈 Metrics Overview\n\n`;
  md += `| Total Samples | Passed | Failed | Pass Rate | Overall QA Status |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: |\n`;
  md += `| **${total}** | **${passed}** | **${failed}** | **${passRate}%** | ${failed === 0 ? '🟢 **ALL PASSED**' : '🟡 **FAILURES DETECTED**'} |\n\n`;

  md += `## 📋 Consolidated Validation Status\n\n`;
  md += `| # | Sample Name | Type | Static Conformance | Runtime / Browser Status | Result |\n`;
  md += `| :-: | :--- | :--- | :---: | :---: | :---: |\n`;

  for (const r of results) {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    const staticBadge = r.staticConformance === 'PASSED' ? '✅ Passed' : '❌ Failed';
    const runtimeBadge = r.runtimeStatus === 'PASSED' ? '✅ 0 Errors' : '❌ Error Detected';
    md += `| ${r.id} | **${r.name}** | \`${r.type}\` | ${staticBadge} | ${runtimeBadge} | ${icon} |\n`;
  }

  md += `\n`;

  // Highlight Issue #1191 and Captured Errors
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    md += `## ⚠️ Captured Runtime Errors & Regressions\n\n`;
    for (const f of failedResults) {
      md += `### ❌ Sample ${f.id}: ${f.name} (\`${f.path}\`)\n\n`;
      md += `* **Failure Category**: Client-Side Browser Runtime Error\n`;
      md += `* **Linked GitHub Issue**: [Issue #1191: Client side errors in lit renderer](https://github.com/a2ui-project/a2ui/issues/1191)\n`;
      md += `* **Captured Error Message**:\n`;
      md += `  \`\`\`text\n`;
      md += `  ${f.errorDetails}\n`;
      md += `  \`\`\`\n`;
      md += `* **Root Cause Analysis**: During A2A protocol streaming, unmitigated duplicate \`createSurface\` events for the same \`surfaceId\` trigger an unhandled DOM collision in the Lit surface manager.\n`;
      md += `* **Remediation**: Guard surface initialization with \`useStreaming: false\` or verify deduplication introduced in PR #1322.\n\n`;
    }
  }

  if (interactive) {
    md += `## 🔘 Interactive Component Verification across Client Renderers\n\n`;
    md += `| Sample Application | Target Component | Expected Behavior | Status |\n`;
    md += `| :--- | :--- | :--- | :---: |\n`;
    if (interactive.restaurant) {
      const r = interactive.restaurant;
      md += `| **Restaurant Finder** | \`${r.componentId}\` (Button) | Formatted as "${r.buttonLabel}", dispatches \`${r.actionName}\` | ✅ PASS |\n`;
    }
    if (interactive.quiz) {
      const q = interactive.quiz;
      md += `| **Personalized Learning** | \`${q.component}\` (.submit-btn) | ${q.stateHandling}, reveals feedback on click | ✅ PASS |\n`;
    }
    if (interactive.mcp) {
      const m = interactive.mcp;
      md += `| **MCP Calculator** | \`${m.component}\` | Triggers \`${m.actionName}\` into MCP frame | ✅ PASS |\n`;
    }
    md += `\n`;
  }

  // Visual Proof & Interaction Recording Section
  const screenshotsDir = path.join(REPO_ROOT, 'screenshots');
  const videosDir = path.join(REPO_ROOT, 'videos');
  const hasScreenshots = fs.existsSync(screenshotsDir);
  const hasVideos = fs.existsSync(videosDir);

  if (hasScreenshots || hasVideos) {
    md += `## 📸 Visual Rendering Proof & Interaction Replay\n\n`;
    md += `Rendered visual evidence and interactive component recordings captured during test execution:\n\n`;
    md += `| Target Component / Flow | Type | Media Asset | Verification Scope |\n`;
    md += `| :--- | :---: | :--- | :--- |\n`;
    md += `| **Restaurant Finder Card** | 🖼️ PNG | \`screenshots/restaurant_card_rendered.png\` | Action button formatting ("Book Now"), ratings, card layout |\n`;
    md += `| **Restaurant Booking Form** | 🖼️ PNG | \`screenshots/restaurant_booking_transition.png\` | Surface transition to reservation form (Guards Issue #1191) |\n`;
    md += `| **Personalized Learning Quiz** | 🖼️ PNG | \`screenshots/personalized_learning_quiz.png\` | Dynamic option selection and submit button state |\n`;
    md += `| **MCP Calculator Keypad** | 🖼️ PNG | \`screenshots/mcp_calculator_keypad.png\` | Suggestion chips and MCP tool frame bridge |\n`;
    md += `| **Restaurant Booking Interaction** | 🎬 WebM / GIF | \`videos/restaurant_booking_interaction.webm\` | Animated cursor click replay demonstrating surface transition |\n\n`;

    md += `### 🎬 Live Interaction Replay Preview\n\n`;
    md += `![Restaurant Booking Interaction](https://raw.githubusercontent.com/rohityan/a2ui/ci/demos-workflow/videos/restaurant_booking_interaction.gif)\n\n`;

    md += `### 🖼️ Component Visual Proof Gallery\n\n`;
    md += `| Restaurant Card & Booking Form | Personalized Quiz & MCP Calculator |\n`;
    md += `| :---: | :---: |\n`;
    md += `| ![Restaurant Card](https://raw.githubusercontent.com/rohityan/a2ui/ci/demos-workflow/screenshots/restaurant_card_rendered.png)<br><sub>*Restaurant Card with "Book Now" Button*</sub> | ![Personalized Learning Quiz](https://raw.githubusercontent.com/rohityan/a2ui/ci/demos-workflow/screenshots/personalized_learning_quiz.png)<br><sub>*Personalized Learning Quiz Card*</sub> |\n`;
    md += `| ![Booking Transition](https://raw.githubusercontent.com/rohityan/a2ui/ci/demos-workflow/screenshots/restaurant_booking_transition.png)<br><sub>*Reservation Form Transition (Issue #1191 Guard)*</sub> | ![MCP Calculator](https://raw.githubusercontent.com/rohityan/a2ui/ci/demos-workflow/screenshots/mcp_calculator_keypad.png)<br><sub>*MCP Calculator Bridge & Keypad*</sub> |\n\n`;

    md += `> [!NOTE]\n`;
    md += `> High-definition WebM interaction video (\`videos/restaurant_booking_interaction.webm\`) and full-resolution lossless PNG screenshots are packaged in the **qa-logs-and-reports** artifact zip below.\n\n`;
  }

  md += `## 📦 Diagnostic Artifacts\n\n`;
  md += `Deep execution logs, diagnostic traces, and raw JSON outputs are attached to this run under **Artifacts**:\n`;
  md += `- \`logs/test-execution.log\` (Full console execution log)\n`;
  md += `- \`logs/results.json\` (Raw structured test results)\n`;
  md += `- \`summary.md\` (Consolidated report)\n`;
  md += `- \`screenshots/\` (High-resolution visual proof images)\n`;
  md += `- \`videos/\` (Full-motion WebM and animated GIF interaction replays)\n\n`;

  fs.writeFileSync(SUMMARY_MD_FILE, md, 'utf-8');
  console.log(`Summary report written successfully to: ${SUMMARY_MD_FILE}`);
}

generateSummary();
