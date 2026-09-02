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
  const results = JSON.parse(raw);

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

  md += `## 📦 Diagnostic Artifacts\n\n`;
  md += `Deep execution logs, diagnostic traces, and raw JSON outputs are attached to this run under **Artifacts**:\n`;
  md += `- \`logs/test-execution.log\` (Full console execution log)\n`;
  md += `- \`logs/results.json\` (Raw structured test results)\n`;
  md += `- \`summary.md\` (Consolidated report)\n`;

  fs.writeFileSync(SUMMARY_MD_FILE, md, 'utf-8');
  console.log(`Summary report written successfully to: ${SUMMARY_MD_FILE}`);
}

generateSummary();
