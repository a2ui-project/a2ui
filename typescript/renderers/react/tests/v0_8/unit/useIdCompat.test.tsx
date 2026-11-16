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

import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {useIdCompat, useIdFallback} from '../../../src/v0_8/hooks/useIdCompat';

describe('useIdCompat', () => {
  it('generates unique fallback IDs across sibling instances and keeps them stable across re-renders', () => {
    function Pair() {
      const [count, setCount] = useState(0);
      const firstId = useIdFallback();
      const secondId = useIdFallback();
      return (
        <div>
          <span data-testid="first">{firstId}</span>
          <span data-testid="second">{secondId}</span>
          <span data-testid="count">{count}</span>
          <button type="button" onClick={() => setCount(c => c + 1)}>
            Increment
          </button>
        </div>
      );
    }

    render(<Pair />);
    const initialFirst = screen.getByTestId('first').textContent;
    const initialSecond = screen.getByTestId('second').textContent;

    expect(initialFirst).toBeTruthy();
    expect(initialSecond).toBeTruthy();
    expect(initialFirst).not.toBe(initialSecond);

    fireEvent.click(screen.getByRole('button', {name: 'Increment'}));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('first').textContent).toBe(initialFirst);
    expect(screen.getByTestId('second').textContent).toBe(initialSecond);
  });

  it('provides unique IDs via useIdCompat on the active React runtime', () => {
    function Pair() {
      const firstId = useIdCompat();
      const secondId = useIdCompat();
      return (
        <div>
          <span data-testid="first">{firstId}</span>
          <span data-testid="second">{secondId}</span>
        </div>
      );
    }

    render(<Pair />);
    const first = screen.getByTestId('first').textContent;
    const second = screen.getByTestId('second').textContent;

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
