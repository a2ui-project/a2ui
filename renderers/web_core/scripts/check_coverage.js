// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from 'fs';
import path from 'path';

const lcovPath = path.resolve(process.cwd(), 'coverage.lcov');

if (!fs.existsSync(lcovPath)) {
  console.error(`Error: coverage.lcov not found at ${lcovPath}`);
  process.exit(1);
}

const content = fs.readFileSync(lcovPath, 'utf8');
const lines = content.split('\n');

let linesFound = 0;
let linesHit = 0;

for (const line of lines) {
  if (line.startsWith('LF:')) {
    linesFound += parseInt(line.substring(3).trim(), 10);
  } else if (line.startsWith('LH:')) {
    linesHit += parseInt(line.substring(3).trim(), 10);
  }
}

if (linesFound === 0) {
  console.error('Error: No lines found in LCOV report.');
  process.exit(1);
}

const coverage = (linesHit / linesFound) * 100;
console.log(`Web Core Code Coverage Summary:`);
console.log(`  Lines Found: ${linesFound}`);
console.log(`  Lines Hit:   ${linesHit}`);
console.log(`  Overall Line Coverage: ${coverage.toFixed(2)}%`);

if (coverage < 90) {
  console.error(`❌ FAIL: Code coverage (${coverage.toFixed(2)}%) is below the 90% target!`);
  process.exit(1);
} else {
  console.log(`🟢 PASS: Code coverage (${coverage.toFixed(2)}%) meets the 90% target!`);
  process.exit(0);
}
