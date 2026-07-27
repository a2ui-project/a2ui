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

import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {A2UIProvider, useA2UI} from '../../../src/v0_8';
import {getElement} from '../utils';

/**
 * Context Hooks Integration Tests
 *
 * Tests for React context hooks behavior and stability.
 */

describe('Context Hooks', () => {
  it('should throw error when useA2UI is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadComponent() {
      useA2UI();
      return null;
    }

    expect(() => {
      render(<BadComponent />);
    }).toThrow();

    consoleSpy.mockRestore();
  });

  it('should provide stable action references across renders', () => {
    const actionRefs: Array<ReturnType<typeof useA2UI>> = [];

    function ActionTracker() {
      const api = useA2UI();
      actionRefs.push(api);

      return <button onClick={() => api.processMessages([])}>Trigger</button>;
    }

    const {rerender} = render(
      <A2UIProvider>
        <ActionTracker />
      </A2UIProvider>,
    );

    rerender(
      <A2UIProvider>
        <ActionTracker />
      </A2UIProvider>,
    );

    const ref0 = getElement(actionRefs, 0);
    const ref1 = getElement(actionRefs, 1);
    expect(ref0.processMessages).toBe(ref1.processMessages);
  });
});
