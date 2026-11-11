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

import {cleanup, render, screen} from '@testing-library/react';
import {createElement, forwardRef, lazy, memo} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {AppRoot, isComponentType} from './app_root.js';

function App() {
  return null;
}

describe('isComponentType', () => {
  it('accepts functions and the memo, forwardRef and lazy wrappers', () => {
    expect(isComponentType(App)).toBe(true);
    expect(isComponentType(memo(App))).toBe(true);
    expect(isComponentType(forwardRef(() => null))).toBe(true);
    expect(isComponentType(lazy(() => Promise.resolve({default: App})))).toBe(true);
  });

  it('rejects elements and other values', () => {
    expect(isComponentType(createElement(App))).toBe(false);
    expect(isComponentType({render: App})).toBe(false);
    expect(isComponentType(undefined)).toBe(false);
    expect(isComponentType('App')).toBe(false);
  });
});

describe('AppRoot', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a memo app', () => {
    const Memo = memo(() => <p>memo app</p>);
    render(<AppRoot app={Memo} title="T" onError={() => {}} onCommit={() => {}} />);

    expect(screen.getByText('memo app')).toBeTruthy();
  });

  it('shows a decoded minified React error on the error card', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    function Broken(): null {
      throw new Error(
        'Minified React error #321; visit https://react.dev/errors/321 for the full message or ' +
          'use the non-minified dev environment for full errors and additional helpful warnings.',
      );
    }
    render(<AppRoot app={Broken} title="Trip" onError={onError} onCommit={() => {}} />);

    expect(screen.getByRole('alert').textContent).toContain(
      'React error #321: Hooks can only be called inside the body of a function component.',
    );
    expect(onError).toHaveBeenCalledOnce();
  });
});
