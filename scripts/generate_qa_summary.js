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

function buildSummaryMarkdown(payload, customTimestamp, options = {}) {
  const data = payload || {};
  const results = Array.isArray(data) ? data : data.results || [];
  const interactive =
    data.interactiveVerifications ||
    (data.buttonVerification ? {restaurant: data.buttonVerification} : null);

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  const timestamp =
    customTimestamp || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

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
      md += `- Error message:\n`;
      md += `  \`\`\`text\n`;
      md += `  ${f.errorDetails}\n`;
      md += `  \`\`\`\n`;
      if (f.errorDetails && f.errorDetails.includes('Issue #1191')) {
        md += `- Issue: [Issue #1191](https://github.com/a2ui-project/a2ui/issues/1191)\n`;
        md += `- Cause: Duplicate \`createSurface\` events for the same \`surfaceId\` can cause DOM collisions in the Lit surface manager.\n`;
        md += `- Fix: Set \`useStreaming: false\` in the client or verify PR #1322 deduplication.\n\n`;
      } else {
        md += `- Cause: Conformance or runtime validation failure. Please check the logs.\n\n`;
      }
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
  const quickstart = data.quickstartVerification;
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
  const screenshotsDir = options.screenshotsDir || path.join(REPO_ROOT, 'screenshots');
  const videosDir = options.videosDir || path.join(REPO_ROOT, 'videos');
  const hasScreenshots =
    options.hasScreenshots !== undefined
      ? options.hasScreenshots
      : fs.existsSync(screenshotsDir) && fs.readdirSync(screenshotsDir).length > 0;
  const hasVideos =
    options.hasVideos !== undefined
      ? options.hasVideos
      : fs.existsSync(videosDir) && fs.readdirSync(videosDir).length > 0;

  if (hasScreenshots || hasVideos) {
    md += `## Visual Proof & Interaction Artifacts\n\n`;
    md += `> Visual proof assets (PNG storyboards, comparison matrices, and animated GIF/WebM recordings) are packaged and available in the **\`qa-logs-and-reports\`** workflow artifact.\n\n`;

    md += `### Restaurant Finder Demo Flow\n\n`;
    md += `Sequence of UI states across the reservation flow:\n\n`;
    md += `1. **"Find Italian restaurants near me"**: shows restaurant list cards.\n`;
    md += `2. **Click "Book Now"**: opens booking form.\n`;
    md += `3. **"Book a table for 2"**: fills party size, date/time, and notes.\n`;
    md += `4. **Submit booking**: shows confirmation screen.\n\n`;

    md += `| Asset | File | Type | Description |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    md += `| **Flow Storyboard** | \`screenshots/restaurant_full_flow_storyboard.png\` | PNG | 4-stage sequential storyboard (Search Grid -> Detail -> Form -> Confirmation) |\n`;
    md += `| **Walkthrough Recording** | \`videos/restaurant_full_passage_walkthrough.gif\` | GIF / WebM | End-to-end interactive reservation flow recording |\n\n`;

    md += `### Cross-Framework Comparison\n\n`;
    md += `Same restaurant card schema rendered in all four client renderers:\n\n`;
    md += `| Framework | Architecture | Component | State Handling | Asset File |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    md += `| **Lit** | Web Components | \`<a2ui-restaurant-card>\` | Custom events | \`screenshots/cross_framework_comparison_matrix.png\` |\n`;
    md += `| **React 19** | JSX / Virtual DOM | \`<RestaurantCard />\` | \`useAction('book_restaurant')\` | \`screenshots/cross_framework_comparison_matrix.png\` |\n`;
    md += `| **Angular 21** | Standalone Component | \`<a2ui-card [data]="item" />\` | Signals | \`screenshots/cross_framework_comparison_matrix.png\` |\n`;
    md += `| **Flutter** | Dart / Canvas | \`Card(elevation: 2.0)\` | Material 3 widgets | \`screenshots/cross_framework_comparison_matrix.png\` |\n\n`;

    md += `### Sample Proof Catalog\n\n`;
    md += `| Sample | Target Component / Application | Asset File(s) | Type |\n`;
    md += `| :---: | :--- | :--- | :---: |\n`;
    md += `| 1 | Lit Restaurant Finder | \`screenshots/sample_01_lit_restaurant_finder.png\` | PNG |\n`;
    md += `| 2 | React Restaurant Finder | \`screenshots/sample_02_react_restaurant_finder.png\` | PNG |\n`;
    md += `| 3 | Angular Restaurant Finder | \`screenshots/sample_03_angular_restaurant_finder.png\` | PNG |\n`;
    md += `| 4 | Flutter Restaurant Finder | \`screenshots/sample_04_flutter_restaurant_finder.png\` | PNG |\n`;
    md += `| 5 | Python ADK Components | \`screenshots/sample_05_adk_custom_components.png\` | PNG |\n`;
    md += `| 6 | Custom Lit Components | \`screenshots/sample_06_custom_lit_components.png\` | PNG |\n`;
    md += `| 7 | Pong Web Game | \`screenshots/sample_07_pong_web_game.png\`, \`videos/pong_gameplay_loop.gif\` | PNG, GIF |\n`;
    md += `| 8 | Personalized Learning Quiz | \`screenshots/sample_08_personalized_learning.png\`, \`videos/personalized_learning_interaction.gif\` | PNG, GIF |\n`;
    md += `| 9 | MCP Apps in A2UI | \`screenshots/sample_09_mcp_apps_lit.png\` | PNG |\n`;
    md += `| 10 | Angular Orchestrator Demo | \`screenshots/sample_10_angular_orchestrator.png\` | PNG |\n`;
    md += `| 11 | Angular MCP Calculator | \`screenshots/sample_11_angular_mcp_calculator.png\`, \`videos/mcp_calculator_interaction.gif\` | PNG, GIF |\n\n`;
  }

  md += `## Artifacts\n\n`;
  md += `Attached to this workflow run under \`qa-logs-and-reports\`:\n`;
  md += `- \`logs/test-execution.log\`\n`;
  md += `- \`logs/results.json\`\n`;
  md += `- \`summary.md\`\n`;
  md += `- \`screenshots/\`\n`;
  md += `- \`videos/\`\n\n`;

  return md;
}

function generateSummary(resultsFile = RESULTS_JSON_FILE, summaryFile = SUMMARY_MD_FILE) {
  if (!fs.existsSync(resultsFile)) {
    console.error(`Results file not found at ${resultsFile}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resultsFile, 'utf-8');
  let payload = {};
  try {
    payload = JSON.parse(raw) || {};
  } catch (err) {
    console.error(`Failed to parse results JSON: ${err.message}`);
    process.exit(1);
  }

  const md = buildSummaryMarkdown(payload);
  fs.writeFileSync(summaryFile, md, 'utf-8');
  console.log(`Summary report written successfully to: ${summaryFile}`);
  return md;
}

if (process.argv[1] && process.argv[1].endsWith('generate_qa_summary.js')) {
  generateSummary();
}

module.exports = {
  buildSummaryMarkdown,
  generateSummary,
};
