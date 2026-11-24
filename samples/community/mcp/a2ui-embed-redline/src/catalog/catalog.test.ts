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

// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';

import {buildCounterEmail, computeNegotiationMetrics} from './functions.js';
import {REDLINE_CATALOG_ID, redlineCatalog} from './index.js';
import type {ClauseModelItem} from './types.js';

const SAMPLE_CLAUSES: ClauseModelItem[] = [
  {
    id: 'deposit',
    section: '§4',
    title: 'Security Deposit',
    exposureAccept: 4800,
    exposureFallback: 1600,
    exposureCounter: 0,
    frictionCounter: 28,
    frictionFallback: 12,
    counterAsk: 'Cap deposit at 1.0 month ($3,200).',
    fallbackAsk: 'Cap deposit at 1.5 months ($4,800).',
  },
  {
    id: 'late_fee',
    section: '§7',
    title: 'Late Fee',
    exposureAccept: 1800,
    exposureFallback: 450,
    exposureCounter: 120,
    frictionCounter: 24,
    frictionFallback: 10,
    counterAsk: '5-day grace + flat 4% cap.',
    fallbackAsk: '4-day grace + flat 5% cap.',
  },
  {
    id: 'renewal_notice',
    section: '§14',
    title: 'Auto-Renewal',
    exposureAccept: 3200,
    exposureFallback: 800,
    exposureCounter: 0,
    frictionCounter: 24,
    frictionFallback: 10,
    counterAsk: 'Convert to month-to-month after Month 12.',
    fallbackAsk: 'Shorten notice window to 30 days.',
  },
];

describe('redlineCatalog', () => {
  it('registers only custom Redline Studio components and functions (zero basicCatalog)', () => {
    expect(redlineCatalog.id).toBe(REDLINE_CATALOG_ID);
    expect([...redlineCatalog.components.keys()]).toEqual([
      'NegotiationBoard',
      'TwoUpRow',
      'ClauseRedline',
      'BenchmarkBullet',
      'ExposureMeter',
      'LeverageGauge',
      'MilestoneScheduleBar',
      'CounterLetterPreview',
    ]);
    for (const basicName of [
      'Text',
      'Button',
      'Card',
      'Row',
      'Column',
      'Icon',
      'ChoicePicker',
      'TextField',
      'Tabs',
      'Modal',
    ]) {
      expect(redlineCatalog.components.has(basicName)).toBe(false);
    }
    expect([...redlineCatalog.functions.keys()]).toEqual([
      'negotiationMetrics',
      'composeCounterEmail',
    ]);
  });
});

describe('computeNegotiationMetrics', () => {
  it('computes downside exposure and shifts friction across low, balanced, and high bands', () => {
    const allAccepted = computeNegotiationMetrics(SAMPLE_CLAUSES, {
      deposit: 'accept',
      late_fee: 'accept',
      renewal_notice: 'accept',
    });
    expect(allAccepted.currentExposure).toBe(9800);
    expect(allAccepted.maxExposure).toBe(9800);
    expect(allAccepted.minExposure).toBe(120);
    expect(allAccepted.savedDollars).toBe(0);
    expect(allAccepted.frictionBand).toBe('low');
    expect(allAccepted.frictionLabel).toBe('Low friction — high acceptance odds');

    const balanced = computeNegotiationMetrics(SAMPLE_CLAUSES, {
      deposit: 'counter',
      late_fee: 'counter',
      renewal_notice: 'fallback',
    });
    expect(balanced.currentExposure).toBe(920);
    expect(balanced.savedDollars).toBe(8880);
    expect(balanced.frictionBand).toBe('balanced');

    const overPushed = computeNegotiationMetrics(SAMPLE_CLAUSES, {
      deposit: 'counter',
      late_fee: 'counter',
      renewal_notice: 'counter',
    });
    expect(overPushed.currentExposure).toBe(120);
    expect(overPushed.savedDollars).toBe(9680);
    expect(overPushed.frictionBand).toBe('high');
    expect(overPushed.frictionLabel).toBe('Over-pushed — counterparty may walk');
  });
});

describe('buildCounterEmail', () => {
  it('formats collaborative and firm counter-offer emails from active stances', () => {
    const collab = buildCounterEmail(
      '245 Valencia Lease',
      SAMPLE_CLAUSES,
      {deposit: 'counter', late_fee: 'accept', renewal_notice: 'fallback'},
      'collaborative',
    );
    expect(collab).toContain('Subject: Quick notes on 245 Valencia Lease');
    expect(collab).toContain('• §4 (Security Deposit): Cap deposit at 1.0 month ($3,200).');
    expect(collab).toContain('• §14 (Auto-Renewal): Shorten notice window to 30 days.');
    expect(collab).toContain('Everything else (Late Fee) works great as written.');

    const firm = buildCounterEmail(
      '245 Valencia Lease',
      SAMPLE_CLAUSES,
      {deposit: 'counter', late_fee: 'accept', renewal_notice: 'fallback'},
      'firm',
    );
    expect(firm).toContain('Subject: Requested redlines — 245 Valencia Lease');
    expect(firm).toContain('1. §4 (Security Deposit): Cap deposit at 1.0 month ($3,200).');
    expect(firm).toContain('Please circulate an updated draft');
  });

  it('produces a clean ready-to-sign note when every clause is accepted', () => {
    const accepted = buildCounterEmail(
      '245 Valencia Lease',
      SAMPLE_CLAUSES,
      {deposit: 'accept', late_fee: 'accept', renewal_notice: 'accept'},
      'collaborative',
    );
    expect(accepted).toContain('Subject: Ready to sign — 245 Valencia Lease');
    expect(accepted).toContain('ready to sign whenever you send the final copy');
  });
});
