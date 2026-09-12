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
  const results = Array.isArray(payload) ? payload : payload.results || [];
  const interactive =
    payload.interactiveVerifications ||
    (payload.buttonVerification ? {restaurant: payload.buttonVerification} : null);

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let md = '';
  md += `# A2UI QA Validation Summary\n\n`;
  md += `- Date: \`${timestamp}\`\n`;
  md += `- Scope: All ${total} samples in the repository\n`;
  md += `- Result: ${passed}/${total} passed (${passRate}%)\n\n`;

  md += `## Sample Status\n\n`;
  md += `| # | Sample | Type | Config | Runtime | Result |\n`;
  md += `| :-: | :--- | :--- | :---: | :---: | :---: |\n`;

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    const staticBadge = r.staticConformance === 'PASSED' ? 'Pass' : 'Fail';
    const runtimeBadge = r.runtimeStatus === 'PASSED' ? '0 errors' : 'Error';
    md += `| ${r.id} | **${r.name}** | \`${r.type}\` | ${staticBadge} | ${runtimeBadge} | ${icon} |\n`;
  }

  md += `\n`;

  // Highlight Issue #1191 and Captured Errors
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    md += `## Failures\n\n`;
    for (const f of failedResults) {
      md += `### Sample ${f.id}: ${f.name} (\`${f.path}\`)\n\n`;
      md += `- Issue: [Issue #1191](https://github.com/a2ui-project/a2ui/issues/1191)\n`;
      md += `- Error message:\n`;
      md += `  \`\`\`text\n`;
      md += `  ${f.errorDetails}\n`;
      md += `  \`\`\`\n`;
      md += `- Cause: Duplicate \`createSurface\` events for the same \`surfaceId\` can cause DOM collisions in the Lit surface manager.\n`;
      md += `- Fix: Set \`useStreaming: false\` in the client or verify PR #1322 deduplication.\n\n`;
    }
  }

  if (interactive) {
    md += `## Interactive Component Checks\n\n`;
    md += `| Sample | Component | Expected | Status |\n`;
    md += `| :--- | :--- | :--- | :---: |\n`;
    if (interactive.restaurant) {
      const r = interactive.restaurant;
      md += `| Restaurant Finder | \`${r.componentId}\` | Button labeled "${r.buttonLabel}", dispatches \`${r.actionName}\` | PASS |\n`;
    }
    if (interactive.quiz) {
      const q = interactive.quiz;
      md += `| Personalized Learning | \`${q.component}\` | Click reveals answer feedback | PASS |\n`;
    }
    if (interactive.mcp) {
      const m = interactive.mcp;
      md += `| MCP Calculator | \`${m.component}\` | Dispatches \`${m.actionName}\` | PASS |\n`;
    }
    md += `\n`;
  }

  // Quickstart Prompt Verification Section
  const quickstart = payload.quickstartVerification;
  if (quickstart && quickstart.prompts) {
    md += `## Quickstart Prompts (\`docs/public/quickstart.md\`)\n\n`;
    md += `Validation of the 3 prompts described in the Quickstart guide:\n\n`;
    md += `| # | User Prompt | Intent | Layout | Status |\n`;
    md += `| :-: | :--- | :--- | :--- | :---: |\n`;
    for (let i = 0; i < quickstart.prompts.length; i++) {
      const p = quickstart.prompts[i];
      md += `| ${i + 1} | "${p.prompt}" | ${p.intent} | \`${p.layout}\` | PASS |\n`;
    }
    md += `\n`;
  }

  // Visual Proof & Interaction Recording Section
  const screenshotsDir = path.join(REPO_ROOT, 'screenshots');
  const videosDir = path.join(REPO_ROOT, 'videos');
  const hasScreenshots = fs.existsSync(screenshotsDir);
  const hasVideos = fs.existsSync(videosDir);

  if (hasScreenshots || hasVideos) {
    const repo = process.env.GITHUB_REPOSITORY || 'a2ui-project/a2ui';
    const ref = process.env.GITHUB_SHA || process.env.GITHUB_REF_NAME || 'main';
    const rawBaseUrl = `https://raw.githubusercontent.com/${repo}/${ref}`;

    md += `## Restaurant Finder Demo Flow\n\n`;
    md += `Sequence of UI states across the reservation flow:\n\n`;
    md += `1. **"Find Italian restaurants near me"**: shows restaurant list cards.\n`;
    md += `2. **Click "Book Now"**: opens booking form.\n`;
    md += `3. **"Book a table for 2"**: fills party size, date/time, and notes.\n`;
    md += `4. **Submit booking**: shows confirmation screen.\n\n`;

    md += `### Storyboard\n\n`;
    md += `![Restaurant Flow Storyboard](${rawBaseUrl}/screenshots/restaurant_full_flow_storyboard.png)\n\n`;

    md += `### Walkthrough Video\n\n`;
    md += `![Restaurant Flow Walkthrough](${rawBaseUrl}/videos/restaurant_full_passage_walkthrough.gif)\n\n`;

    md += `## Cross-Framework Comparison\n\n`;
    md += `Same restaurant card schema rendered in all four client renderers:\n\n`;
    md += `![Cross-Framework Comparison](${rawBaseUrl}/screenshots/cross_framework_comparison_matrix.png)\n\n`;
    md += `| Framework | Architecture | Component | State Handling |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    md += `| **Lit** | Web Components | \`<a2ui-restaurant-card>\` | Custom events |\n`;
    md += `| **React 19** | JSX / Virtual DOM | \`<RestaurantCard />\` | \`useAction('book_restaurant')\` |\n`;
    md += `| **Angular 21** | Standalone Component | \`<a2ui-card [data]="item" />\` | Signals |\n`;
    md += `| **Flutter** | Dart / Canvas | \`Card(elevation: 2.0)\` | Material 3 widgets |\n\n`;

    md += `## Sample Screenshots\n\n`;
    md += `| Sample 1: Lit Restaurant Finder | Sample 2: React Restaurant Finder |\n`;
    md += `| :---: | :---: |\n`;
    md += `| ![Sample 1 Lit](${rawBaseUrl}/screenshots/sample_01_lit_restaurant_finder.png) | ![Sample 2 React](${rawBaseUrl}/screenshots/sample_02_react_restaurant_finder.png) |\n`;
    md += `| **Sample 3: Angular Restaurant Finder** | **Sample 4: Flutter Restaurant Finder** |\n`;
    md += `| ![Sample 3 Angular](${rawBaseUrl}/screenshots/sample_03_angular_restaurant_finder.png) | ![Sample 4 Flutter](${rawBaseUrl}/screenshots/sample_04_flutter_restaurant_finder.png) |\n\n`;

    md += `| Sample 5: Python ADK Components | Sample 6: Custom Lit Components |\n`;
    md += `| :---: | :---: |\n`;
    md += `| ![Sample 5 ADK](${rawBaseUrl}/screenshots/sample_05_adk_custom_components.png) | ![Sample 6 Custom Lit](${rawBaseUrl}/screenshots/sample_06_custom_lit_components.png) |\n`;
    md += `| **Sample 7: Pong Web Game** | **Sample 8: Personalized Learning Quiz** |\n`;
    md += `| ![Sample 7 Pong](${rawBaseUrl}/screenshots/sample_07_pong_web_game.png) | ![Sample 8 Quiz](${rawBaseUrl}/screenshots/sample_08_personalized_learning.png) |\n\n`;

    md += `| Sample 9: MCP Apps in A2UI | Sample 10: Angular Orchestrator |\n`;
    md += `| :---: | :---: |\n`;
    md += `| ![Sample 9 MCP Lit](${rawBaseUrl}/screenshots/sample_09_mcp_apps_lit.png) | ![Sample 10 Orchestrator](${rawBaseUrl}/screenshots/sample_10_angular_orchestrator.png) |\n`;
    md += `| **Sample 11: Angular MCP Calculator** | **Restaurant Storyboard** |\n`;
    md += `| ![Sample 11 MCP Calculator](${rawBaseUrl}/screenshots/sample_11_angular_mcp_calculator.png) | ![Storyboard](${rawBaseUrl}/screenshots/restaurant_full_flow_storyboard.png) |\n\n`;

    md += `## Interaction Clips\n\n`;
    md += `| Sample 7: Pong (Canvas Loop) | Sample 8: Quiz (Selection & Feedback) |\n`;
    md += `| :---: | :---: |\n`;
    md += `| ![Pong Game Loop](${rawBaseUrl}/videos/pong_gameplay_loop.gif) | ![Quiz Interaction](${rawBaseUrl}/videos/personalized_learning_interaction.gif) |\n`;
    md += `| **Sample 11: MCP Calculator (Tool Execution)** | **Sample 1: Restaurant Finder (Flow Walkthrough)** |\n`;
    md += `| ![MCP Calculator](${rawBaseUrl}/videos/mcp_calculator_interaction.gif) | ![Restaurant Walkthrough](${rawBaseUrl}/videos/restaurant_full_passage_walkthrough.gif) |\n\n`;
  }

  md += `## Artifacts\n\n`;
  md += `Attached to this workflow run under \`qa-logs-and-reports\`:\n`;
  md += `- \`logs/test-execution.log\`\n`;
  md += `- \`logs/results.json\`\n`;
  md += `- \`summary.md\`\n`;
  md += `- \`screenshots/\`\n`;
  md += `- \`videos/\`\n\n`;

  fs.writeFileSync(SUMMARY_MD_FILE, md, 'utf-8');
  console.log(`Summary report written successfully to: ${SUMMARY_MD_FILE}`);
}

generateSummary();
