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

/**
 * Client-side catalog functions for live financial exposure, deal friction,
 * and counter-offer email assembly.
 */

import {z} from 'zod';

import {createFunctionImplementation, spec} from '@a2ui/web_core/v1_0';

import {
  isNegotiationTone,
  isStance,
  type ClauseModelItem,
  type NegotiationMetrics,
  type NegotiationTone,
  type Stance,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseClauses(raw: unknown): ClauseModelItem[] {
  if (!Array.isArray(raw)) return [];
  const clauses: ClauseModelItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item['id'] !== 'string') continue;
    clauses.push({
      id: item['id'],
      section: typeof item['section'] === 'string' ? item['section'] : '',
      title: typeof item['title'] === 'string' ? item['title'] : item['id'],
      exposureAccept: Math.max(0, toFiniteNumber(item['exposureAccept'])),
      exposureFallback: Math.max(0, toFiniteNumber(item['exposureFallback'])),
      exposureCounter: Math.max(0, toFiniteNumber(item['exposureCounter'])),
      frictionCounter: Math.max(0, toFiniteNumber(item['frictionCounter'])),
      frictionFallback: Math.max(0, toFiniteNumber(item['frictionFallback'])),
      counterAsk: typeof item['counterAsk'] === 'string' ? item['counterAsk'] : '',
      fallbackAsk: typeof item['fallbackAsk'] === 'string' ? item['fallbackAsk'] : '',
    });
  }
  return clauses;
}

function stanceFor(stances: unknown, clauseId: string): Stance {
  if (isRecord(stances)) {
    const candidate = stances[clauseId];
    if (isStance(candidate)) return candidate;
  }
  return 'accept';
}

export function formatDollars(amount: number): string {
  const rounded = Math.round(amount);
  return `$${Math.abs(rounded).toLocaleString('en-US')}`;
}

/**
 * Computes worst-case dollar exposure, savings vs signing as-is, and deal-friction
 * odds across all clauses for the user's current stances.
 */
export function computeNegotiationMetrics(
  rawClauses: unknown,
  rawStances: unknown,
): NegotiationMetrics {
  const clauses = parseClauses(rawClauses);
  let currentExposure = 0;
  let maxExposure = 0;
  let minExposure = 0;
  let rawFriction = 0;
  let counterCount = 0;
  let fallbackCount = 0;
  let acceptCount = 0;

  for (const clause of clauses) {
    const stance = stanceFor(rawStances, clause.id);
    maxExposure += clause.exposureAccept;
    minExposure += clause.exposureCounter;
    if (stance === 'counter') {
      currentExposure += clause.exposureCounter;
      rawFriction += clause.frictionCounter;
      counterCount++;
    } else if (stance === 'fallback') {
      currentExposure += clause.exposureFallback;
      rawFriction += clause.frictionFallback;
      fallbackCount++;
    } else {
      currentExposure += clause.exposureAccept;
      acceptCount++;
    }
  }

  // Pushing hard counters on every single clause compounds perceived pushback.
  const allHardBonus = clauses.length >= 3 && counterCount === clauses.length ? 8 : 0;
  const frictionScore = Math.max(0, Math.min(100, Math.round(rawFriction + allHardBonus)));
  const frictionBand: NegotiationMetrics['frictionBand'] =
    frictionScore < 38 ? 'low' : frictionScore <= 72 ? 'balanced' : 'high';
  const frictionLabel =
    frictionBand === 'low'
      ? 'Low friction — high acceptance odds'
      : frictionBand === 'balanced'
        ? 'Balanced pushback — market-grounded ask'
        : 'Over-pushed — counterparty may walk';

  const savedDollars = Math.max(0, maxExposure - currentExposure);
  const exposureRatio = maxExposure > 0 ? Math.min(1, currentExposure / maxExposure) : 0;

  return {
    currentExposure,
    maxExposure,
    minExposure,
    savedDollars,
    exposureRatio,
    frictionScore,
    frictionBand,
    frictionLabel,
    counterCount,
    fallbackCount,
    acceptCount,
    totalClauses: clauses.length,
  };
}

/**
 * Assembles a ready-to-send counter-offer email from the active stances and tone.
 */
export function buildCounterEmail(
  rawDocTitle: unknown,
  rawClauses: unknown,
  rawStances: unknown,
  rawTone: unknown,
): string {
  const docTitle =
    typeof rawDocTitle === 'string' && rawDocTitle.trim().length > 0
      ? rawDocTitle.trim()
      : 'the agreement';
  const clauses = parseClauses(rawClauses);
  const tone: NegotiationTone = isNegotiationTone(rawTone) ? rawTone : 'collaborative';

  const asks: Array<{label: string; text: string}> = [];
  const accepted: string[] = [];

  for (const clause of clauses) {
    const stance = stanceFor(rawStances, clause.id);
    const heading = clause.section ? `${clause.section} (${clause.title})` : clause.title;
    if (stance === 'counter' && clause.counterAsk) {
      asks.push({label: heading, text: clause.counterAsk});
    } else if (stance === 'fallback' && clause.fallbackAsk) {
      asks.push({label: heading, text: clause.fallbackAsk});
    } else {
      accepted.push(clause.title);
    }
  }

  if (asks.length === 0) {
    return tone === 'firm'
      ? `Subject: Ready to execute — ${docTitle}\n\nWe have completed our review of ${docTitle} and accept all clauses as drafted. Please send the execution copy for signature.`
      : `Subject: Ready to sign — ${docTitle}\n\nThanks for sending over ${docTitle}! Everything looks good as drafted, and we are ready to sign whenever you send the final copy.`;
  }

  const bulletLines = asks.map((ask, index) =>
    tone === 'firm' ? `${index + 1}. ${ask.label}: ${ask.text}` : `• ${ask.label}: ${ask.text}`,
  );
  const acceptedLine =
    accepted.length > 0
      ? tone === 'firm'
        ? `\nAll remaining provisions (${accepted.join(', ')}) are acceptable as drafted.`
        : `\nEverything else (${accepted.join(', ')}) works great as written.`
      : '';

  if (tone === 'firm') {
    return [
      `Subject: Requested redlines — ${docTitle}`,
      '',
      `Thank you for sharing ${docTitle}. Before executing, we require the following ${asks.length} market-standard adjustment${asks.length === 1 ? '' : 's'}:`,
      ...bulletLines,
      acceptedLine +
        (acceptedLine ? '\n' : '') +
        'Please circulate an updated draft reflecting these terms so we can proceed to signature.',
    ]
      .filter(line => line !== undefined)
      .join('\n');
  }

  return [
    `Subject: Quick notes on ${docTitle}`,
    '',
    `Thanks for sending over ${docTitle} — excited to move forward! We are ready to sign as soon as we align on ${asks.length === 1 ? 'one quick item' : `these ${asks.length} items`}:`,
    ...bulletLines,
    acceptedLine +
      (acceptedLine ? '\n' : '') +
      "Happy to hop on a quick call if helpful, or send over the updated copy and we'll countersign right away.",
  ]
    .filter(line => line !== undefined)
    .join('\n');
}

export const negotiationMetrics = createFunctionImplementation(
  {
    name: 'negotiationMetrics',
    returnType: 'object',
    description:
      'Computes live worst-case dollar exposure, savings vs signing as-is, and deal-friction score from clauses and active stances.',
    schema: spec(
      z
        .object({
          clauses: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|List of negotiable clause metadata objects.'),
          stances: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicValue|Map of clauseId to stance (accept, counter, fallback).',
            ),
        })
        .strict(),
      {required: ['clauses', 'stances'], closure: 'unevaluatedProperties'},
    ),
  },
  args =>
    computeNegotiationMetrics(args['clauses'], args['stances']) as unknown as Record<
      string,
      unknown
    >,
);

export const composeCounterEmail = createFunctionImplementation(
  {
    name: 'composeCounterEmail',
    returnType: 'string',
    description:
      'Assembles a polite collaborative or firm counter-offer email from docTitle, clauses, active stances, and tone.',
    schema: spec(
      z
        .object({
          docTitle: z
            .unknown()
            .describe('REF:#/$defs/DynamicString|Title of the lease, contract, or quote.'),
          clauses: z
            .unknown()
            .describe('REF:#/$defs/DynamicValue|List of negotiable clause metadata objects.'),
          stances: z
            .unknown()
            .describe(
              'REF:#/$defs/DynamicValue|Map of clauseId to stance (accept, counter, fallback).',
            ),
          tone: z
            .unknown()
            .describe('REF:#/$defs/DynamicString|Email tone: collaborative or firm.'),
        })
        .strict(),
      {required: ['docTitle', 'clauses', 'stances', 'tone'], closure: 'unevaluatedProperties'},
    ),
  },
  args => buildCounterEmail(args['docTitle'], args['clauses'], args['stances'], args['tone']),
);
