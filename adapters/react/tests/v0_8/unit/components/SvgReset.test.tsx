/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {describe, it, expect} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {A2UIProvider} from '../../../../src/v0_8';
import {resetStyles} from '../../../../src/v0_8/styles/reset';
describe('SVG Reset Exclusion', () => {
  it('should have the correct CSS selector in resetStyles', () => {
    expect(resetStyles).toContain(':not(svg, svg *:not(foreignObject *))');
  });
  it('should allow presentational attributes on SVG elements', () => {
    const {container} = render(
      <A2UIProvider>
        <div className="a2ui-surface">
          <svg fill="red" data-testid="test-svg" width="100" height="100">
            <circle cx="50" cy="50" r="40" />
          </svg>
        </div>
      </A2UIProvider>,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('fill', 'red');
  });
});
