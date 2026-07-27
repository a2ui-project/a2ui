/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {EventEmitter} from './events.js';

describe('Events', () => {
  it('handles subscriptions and unsubscriptions correctly', async () => {
    const emitter = new EventEmitter<string>();
    let callCount = 0;
    let lastValue = '';

    const listener = (val: string) => {
      callCount++;
      lastValue = val;
    };

    const sub = emitter.subscribe(listener);

    await emitter.emit('hello');
    assert.strictEqual(callCount, 1);
    assert.strictEqual(lastValue, 'hello');

    sub.unsubscribe();

    await emitter.emit('world');
    assert.strictEqual(callCount, 1); // Should not increase
    assert.strictEqual(lastValue, 'hello'); // Should not change
  });
  it('handles errors thrown by listeners', async () => {
    const emitter = new EventEmitter<string>();
    const originalConsoleError = console.error;
    let errorLogged = false;

    console.error = (msg: string, e: any) => {
      if (msg === 'EventEmitter error:' && e.message === 'Test Error') {
        errorLogged = true;
      }
    };

    try {
      emitter.subscribe(() => {
        throw new Error('Test Error');
      });
      await emitter.emit('trigger');
      assert.strictEqual(errorLogged, true);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
