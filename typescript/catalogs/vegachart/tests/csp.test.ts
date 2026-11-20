/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Renders real charts with the real `vega-embed` under the strict Content
 * Security Policy in `csp_context.html`, which has no 'unsafe-eval'.
 */

import {registerUniversalElement} from '@a2ui/web_core/v1_0';
import embed, {type VisualizationSpec} from 'vega-embed';

import {A2uiVegaChartV1} from '../src/v1/index.js';

registerUniversalElement(A2uiVegaChartV1);

/**
 * A Vega-Lite spec whose rendering runs Vega expressions: a parameter (a
 * signal) computed from an expression, a filter that reads it, and a
 * calculated field. Three of the four rows pass the filter.
 */
const SPEC_WITH_EXPRESSIONS = {
  data: {
    values: [
      {category: 'A', value: 1},
      {category: 'B', value: 5},
      {category: 'C', value: 9},
      {category: 'D', value: 12},
    ],
  },
  params: [{name: 'threshold', expr: '1 + 1'}],
  transform: [{filter: 'datum.value > threshold'}, {calculate: 'datum.value * 10', as: 'scaled'}],
  mark: 'bar',
  encoding: {
    x: {field: 'category', type: 'nominal'},
    y: {field: 'scaled', type: 'quantitative'},
  },
} satisfies VisualizationSpec;

/** Resolves with the result of `probe` once it is truthy, polling every animation frame. */
async function waitFor<T>(probe: () => T | null | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const result = probe();
    if (result) return result;
    if (performance.now() > deadline) throw new Error('Timed out waiting for the chart');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

describe('A2uiVegaChartElement under a strict Content Security Policy', () => {
  let violations: SecurityPolicyViolationEvent[];
  const recordViolation = (event: SecurityPolicyViolationEvent) => violations.push(event);
  let host: HTMLElement;

  beforeEach(() => {
    violations = [];
    document.addEventListener('securitypolicyviolation', recordViolation);
    host = document.createElement('div');
    host.style.width = '480px';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.removeEventListener('securitypolicyviolation', recordViolation);
  });

  it('runs in a page that blocks Function', () => {
    expect(() => new Function('return 1')).toThrowError(EvalError);
  });

  it('renders a spec with expressions without violating the policy', async () => {
    const el = document.createElement('a2ui-vega-chart');
    el.spec = SPEC_WITH_EXPRESSIONS;
    host.appendChild(el);

    const svg = await waitFor(() => el.renderRoot.querySelector('svg'));
    const bars = await waitFor(() => {
      const paths = svg.querySelectorAll('.mark-rect path');
      return paths.length > 0 ? paths : null;
    });
    const labels = Array.from(svg.querySelectorAll('.role-axis-label text'), t => t.textContent);

    expect(bars.length).toBe(3);
    expect(labels).toEqual(jasmine.arrayContaining(['B', 'C', 'D']));
    expect(labels).not.toContain('A');
    // Allow a late violation report to arrive before checking.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(violations.map(v => v.violatedDirective)).toEqual([]);
  });

  it('fails to render the same spec when expressions are compiled', async () => {
    const target = document.createElement('div');
    host.appendChild(target);

    await expectAsync(
      embed(target, SPEC_WITH_EXPRESSIONS, {actions: false, renderer: 'svg', ast: false}),
    ).toBeRejectedWithError(EvalError);
  });
});
