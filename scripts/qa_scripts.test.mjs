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

// Unit tests for verify_samples.js, generate_qa_summary.js, and capture_visual_proof.js.
// Run with `node --test scripts/qa_scripts.test.mjs`.

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {describe, it} from 'node:test';

const require = createRequire(import.meta.url);
const {buildSummaryMarkdown} = require('./generate_qa_summary.js');
const {
  SAMPLES,
  validatePersonalizedLearningComponents,
  validateMcpCalculatorComponents,
  validateRestaurantBookingComponents,
  validateQuickstartPrompts,
} = require('./verify_samples.js');
const {generateProof} = require('./capture_visual_proof.js');

describe('generate_qa_summary (buildSummaryMarkdown)', () => {
  it('handles empty or null payload defensively without throwing', () => {
    const mdNull = buildSummaryMarkdown(null, '2026-09-12 00:00:00 UTC');
    assert.ok(mdNull.includes('# A2UI QA Validation Summary'));
    assert.ok(mdNull.includes('0/0 passed (0.0%)'));

    const mdEmpty = buildSummaryMarkdown({}, '2026-09-12 00:00:00 UTC');
    assert.ok(mdEmpty.includes('0/0 passed (0.0%)'));
  });

  it('formats pass rate, sample status table, and interactive checks correctly', () => {
    const payload = {
      results: [
        {
          id: 1,
          name: 'Lit Restaurant Finder',
          type: 'Client (Web Components)',
          staticConformance: 'PASSED',
          runtimeStatus: 'PASSED',
          passed: true,
        },
        {
          id: 2,
          name: 'React Restaurant Finder',
          type: 'Client (React 19)',
          staticConformance: 'PASSED',
          runtimeStatus: 'FAILED',
          errorDetails: 'Mock runtime failure',
          passed: false,
        },
      ],
      interactiveVerifications: {
        restaurant: {
          componentId: 'booking-btn',
          buttonLabel: 'Book Now',
          actionName: 'book_restaurant',
        },
      },
    };

    const md = buildSummaryMarkdown(payload, '2026-09-12 12:00:00 UTC');
    assert.ok(md.includes('1/2 passed (50.0%)'));
    assert.ok(
      md.includes(
        '| 1 | **Lit Restaurant Finder** | `Client (Web Components)` | Pass | 0 errors | PASS |',
      ),
    );
    assert.ok(
      md.includes(
        '| 2 | **React Restaurant Finder** | `Client (React 19)` | Pass | Error | FAIL |',
      ),
    );
    assert.ok(md.includes('## Failures'));
    assert.ok(md.includes('Mock runtime failure'));
    assert.ok(md.includes('## Interactive Component Checks'));
    assert.ok(md.includes('booking-btn'));
  });

  it('dynamically resolves asset URLs from environment variables', () => {
    const origRepo = process.env.GITHUB_REPOSITORY;
    const origSha = process.env.GITHUB_SHA;

    try {
      process.env.GITHUB_REPOSITORY = 'test-org/custom-a2ui';
      process.env.GITHUB_SHA = 'abc123def456';

      const payload = {
        results: [{id: 1, name: 'Sample', type: 'App', passed: true}],
      };
      const md = buildSummaryMarkdown(payload);

      // Verify that the markdown uses the environment-provided repo and sha
      assert.ok(
        md.includes(
          'https://raw.githubusercontent.com/test-org/custom-a2ui/abc123def456/screenshots/',
        ),
        'Expected dynamic URL to resolve from environment variables',
      );
      assert.ok(
        !md.includes('rohityan/a2ui/ci/demos-workflow'),
        'Must not contain hardcoded personal fork',
      );
    } finally {
      if (origRepo) {
        process.env.GITHUB_REPOSITORY = origRepo;
      } else {
        delete process.env.GITHUB_REPOSITORY;
      }
      if (origSha) {
        process.env.GITHUB_SHA = origSha;
      } else {
        delete process.env.GITHUB_SHA;
      }
    }
  });
});

describe('verify_samples', () => {
  it('defines all 11 required sample targets with valid configurations', () => {
    assert.equal(SAMPLES.length, 11);
    for (const sample of SAMPLES) {
      assert.ok(sample.id >= 1 && sample.id <= 11);
      assert.ok(sample.name.length > 0);
      assert.ok(sample.type.length > 0);
      assert.ok(sample.path.length > 0);
      assert.ok(['package.json', 'pubspec.yaml', 'pyproject.toml'].includes(sample.config));
    }
  });

  it('validates Restaurant Booking interactive components and action event bindings', () => {
    const result = validateRestaurantBookingComponents();
    assert.equal(result.tested, true);
    assert.ok(result.buttonLabel.length > 0);
    assert.equal(result.actionName, 'book_restaurant');
    assert.equal(result.noPlaceholders, true);
    assert.equal(result.contextBound, true);
  });

  it('validates Personalized Learning Quiz interactive components', () => {
    const result = validatePersonalizedLearningComponents();
    assert.equal(result.tested, true);
    assert.equal(result.component, 'a2ui-quizcard');
    assert.equal(result.buttonLabel, 'Check Answer');
    assert.equal(result.actionName, 'handleSubmit');
    assert.equal(result.feedbackFlow, true);
  });

  it('validates MCP Calculator interactive chip components', () => {
    const result = validateMcpCalculatorComponents();
    assert.equal(result.tested, true);
    assert.equal(result.buttonLabel, 'Open Calculator from MCP Server');
    assert.equal(result.actionName, "sendMessage('Open Calculator')");
    assert.equal(result.isFunctional, true);
  });

  it('validates all 3 quickstart prompts documented in quickstart.md', () => {
    const result = validateQuickstartPrompts();
    assert.equal(result.tested, true);
    assert.equal(result.prompts.length, 3);
    assert.equal(result.prompts[0].prompt, 'Find Italian restaurants near me');
    assert.equal(result.prompts[0].status, 'PASSED');
    assert.equal(result.prompts[1].prompt, 'Book a table for 2');
    assert.equal(result.prompts[1].status, 'PASSED');
    assert.equal(result.prompts[2].prompt, 'What are your hours?');
    assert.equal(result.prompts[2].status, 'PASSED');
  });
});

describe('capture_visual_proof', () => {
  it('exports generateProof function', () => {
    assert.equal(typeof generateProof, 'function');
  });
});
