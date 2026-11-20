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

/** The `CheckStatus` component: a CI status badge with an inline SVG icon. */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicStringSchema, spec} from '@a2ui/web_core/v1_0';

/** The states a badge can show. */
export const CHECK_STATES = ['success', 'failure', 'pending', 'neutral', 'skipped'] as const;

export type CheckState = (typeof CHECK_STATES)[number];

/** Component API of `CheckStatus`. */
export const CheckStatusApi = {
  name: 'CheckStatus',
  schema: spec(
    z
      .object({
        state: DynamicStringSchema.describe(
          `REF:#/$defs/DynamicString|One of ${CHECK_STATES.map(state => `"${state}"`).join(', ')}. Other values show as neutral.`,
        ),
        label: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional text next to the icon, such as the check name or "3 of 5 passed".',
        ).optional(),
      })
      .describe('A CI status badge: a colored icon and an optional label.')
      .strict(),
    {mixins: [], required: ['state']},
  ),
} satisfies ComponentApi;

/** Maps a GitHub check run's status and conclusion to a badge state. */
export function checkState(status: string, conclusion: string | null): CheckState {
  if (status !== 'completed') return 'pending';
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'cancelled':
    case 'action_required':
    case 'startup_failure':
      return 'failure';
    case 'skipped':
      return 'skipped';
    default:
      return 'neutral';
  }
}

/** The combined state of several checks: any failure, else any pending, else success when any passed. */
export function combinedState(states: readonly CheckState[]): CheckState {
  if (states.includes('failure')) return 'failure';
  if (states.includes('pending')) return 'pending';
  if (states.includes('success')) return 'success';
  return states.length > 0 ? 'skipped' : 'neutral';
}

function asState(value: unknown): CheckState {
  return CHECK_STATES.includes(value as CheckState) ? (value as CheckState) : 'neutral';
}

const COLORS: Record<CheckState, string> = {
  success: '#1a7f37',
  failure: '#cf222e',
  pending: '#9a6700',
  neutral: '#59636e',
  skipped: '#59636e',
};

const NAMES: Record<CheckState, string> = {
  success: 'Passed',
  failure: 'Failed',
  pending: 'Pending',
  neutral: 'Neutral',
  skipped: 'Skipped',
};

function icon(state: CheckState) {
  switch (state) {
    case 'success':
      return svg`<path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2"/>`;
    case 'failure':
      return svg`<path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="2"/>`;
    case 'pending':
      return svg`<circle cx="8" cy="8" r="3" fill="currentColor"/>`;
    case 'skipped':
      return svg`<path d="M4 12L12 4" fill="none" stroke="currentColor" stroke-width="2"/>`;
    case 'neutral':
      return svg`<path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2"/>`;
  }
}

/** `CheckStatus` element. */
export class A2uiCheckStatusElement extends A2uiLitElement<typeof CheckStatusApi> {
  static readonly tagName = 'a2ui-triage-check-status';

  static override styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
    }
    svg {
      width: 16px;
      height: 16px;
      flex: none;
      border-radius: 50%;
      border: 1.5px solid currentColor;
      box-sizing: border-box;
    }
  `;

  protected override readonly api = CheckStatusApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const state = asState(props.state);
    const label = typeof props.label === 'string' && props.label ? props.label : NAMES[state];
    return html`<span data-state=${state} style="color:${COLORS[state]}"
      ><svg viewBox="0 0 16 16" role="img" aria-label=${NAMES[state]}>${icon(state)}</svg
      ><span style="color:var(--a2ui-color-on-surface, inherit)">${label}</span></span
    >`;
  }
}

/** `CheckStatus` implementation for the triage catalog. */
export const A2uiCheckStatus = {
  ...CheckStatusApi,
  tagName: A2uiCheckStatusElement.tagName,
  element: A2uiCheckStatusElement,
};
