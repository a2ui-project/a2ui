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

/** Shared negotiation data-model shapes used by catalog functions and components. */

export const STANCES = ['accept', 'counter', 'fallback'] as const;
export type Stance = (typeof STANCES)[number];

export const TONES = ['collaborative', 'firm'] as const;
export type NegotiationTone = (typeof TONES)[number];

/** One negotiable clause stored in `/clauses` of the surface data model. */
export interface ClauseModelItem {
  readonly id: string;
  readonly section: string;
  readonly title: string;
  readonly exposureAccept: number;
  readonly exposureFallback: number;
  readonly exposureCounter: number;
  readonly frictionCounter: number;
  readonly frictionFallback: number;
  readonly counterAsk: string;
  readonly fallbackAsk: string;
}

/** Payment milestone segment for `MilestoneScheduleBar`. */
export interface MilestoneSegment {
  readonly label: string;
  readonly percent: number;
}

/** Output of `@call: negotiationMetrics(/clauses, /stances)`. */
export interface NegotiationMetrics {
  readonly currentExposure: number;
  readonly maxExposure: number;
  readonly minExposure: number;
  readonly savedDollars: number;
  readonly exposureRatio: number;
  readonly frictionScore: number;
  readonly frictionBand: 'low' | 'balanced' | 'high';
  readonly frictionLabel: string;
  readonly counterCount: number;
  readonly fallbackCount: number;
  readonly acceptCount: number;
  readonly totalClauses: number;
}

export function isStance(value: unknown): value is Stance {
  return value === 'accept' || value === 'counter' || value === 'fallback';
}

export function isNegotiationTone(value: unknown): value is NegotiationTone {
  return value === 'collaborative' || value === 'firm';
}
