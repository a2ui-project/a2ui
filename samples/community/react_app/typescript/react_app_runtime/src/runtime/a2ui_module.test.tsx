/*
 * Copyright 2026 Google LLC
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

import {cleanup, render, screen} from '@testing-library/react';
import type * as Contract from 'a2ui';
import {afterEach, describe, expect, it} from 'vitest';
import * as a2ui from './a2ui_module.js';
import {applyTheme, theme} from './theme.js';

// Compile-time check: the module implements every declaration of a2ui.d.ts with compatible types.
const implementsContract: typeof Contract = a2ui;

describe('the a2ui module', () => {
  afterEach(() => {
    cleanup();
  });

  it('exports exactly the values a2ui.d.ts declares', () => {
    expect(Object.keys(implementsContract).sort()).toEqual([
      'Button',
      'Card',
      'Slider',
      'Stack',
      'Text',
      'VegaChart',
      'callFunction',
      'dispatchAction',
      'getData',
      'setData',
      'subscribe',
      'theme',
      'useData',
      'useFunction',
      'useTheme',
    ]);
  });

  it('renders the primitives with their classes', () => {
    render(
      <a2ui.Card title="Plan">
        <a2ui.Stack direction="horizontal" gap={3} align="center">
          <a2ui.Text variant="caption" tone="muted">
            note
          </a2ui.Text>
          <a2ui.Button variant="primary">Go</a2ui.Button>
          <a2ui.Slider label="Rate" value={5} onChange={() => {}} format={v => `${v}%`} />
        </a2ui.Stack>
      </a2ui.Card>,
    );

    expect(screen.getByText('Plan').className).toBe('a2ui-card-title');
    expect(screen.getByText('note').className).toBe('a2ui-text a2ui-text-caption a2ui-tone-muted');
    expect(screen.getByRole('button', {name: 'Go'}).className).toBe(
      'a2ui-button a2ui-button-primary',
    );
    expect(screen.getByRole('slider', {name: /Rate/}).getAttribute('value')).toBe('5');
    expect(screen.getByText('5%')).toBeTruthy();
    expect(screen.getByText('note').parentElement?.className).toBe(
      'a2ui-stack a2ui-stack-horizontal a2ui-gap-3 a2ui-align-center',
    );
  });

  it('applies host theme variables to :root and the theme object, and drops unsafe ones', () => {
    applyTheme({
      colorScheme: 'dark',
      cssVars: {
        '--a2ui-color-primary': '#c8553d',
        '--a2ui-font-family': 'Inter Tight, sans-serif',
        '--a2ui-color-border': 'red; } body { display: none',
        '--other': 'x',
      },
    });

    expect(theme.colorScheme).toBe('dark');
    expect(theme.colors.primary).toBe('#c8553d');
    expect(theme.colors.border).toBe('#dadce0');
    expect(theme.fontFamily).toBe('Inter Tight, sans-serif');
    expect(document.documentElement.style.getPropertyValue('--a2ui-color-primary')).toBe('#c8553d');
    expect(document.documentElement.style.getPropertyValue('--a2ui-color-border')).toBe('');
    expect(Object.keys(theme.cssVars)).toEqual(['--a2ui-color-primary', '--a2ui-font-family']);
  });
});
