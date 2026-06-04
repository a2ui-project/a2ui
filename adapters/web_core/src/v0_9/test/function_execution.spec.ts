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

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {DataModel} from '../state/data-model.js';
import {DataContext} from '../rendering/data-context.js';

import {signal} from '@preact/signals-core';

const createTestDataContext = (
  model: DataModel,
  path: string,
  functionInvoker: any = () => null,
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: functionInvoker},
    dispatchError: () => {},
  } as any;
  return new DataContext(mockSurface, path);
};

describe('Function Execution in DataContext', () => {
  it('resolves and subscribes to metronome function', () => {
    const dataModel = new DataModel();

    const functions = new Map<string, Function>();
    // mimic metronome: returns a stream of ticks
    functions.set('metronome', (args: Record<string, any>, abortSignal?: AbortSignal) => {
      const interval = Number(args['interval']) || 100;
      const subj = signal<string>('tick 0');
      let i = 1;
      const timerId = setInterval(() => {
        subj.value = `tick ${i++}`;
      }, interval);

      abortSignal?.addEventListener('abort', () => {
        clearInterval(timerId);
      });

      return subj;
    });

    const context = createTestDataContext(
      dataModel,
      '/',
      (name: string, args: any, _ctx: any, abortSignal?: AbortSignal) => {
        const fn = functions.get(name);
        return fn ? fn(args, abortSignal) : undefined;
      },
    );

    // DynamicValue representing: metronome(interval: 50)
    const dynamicValue = {
      call: 'metronome',
      args: {
        interval: 50,
      },
      returnType: 'string' as const,
    };

    const values: string[] = [];
    return new Promise<void>((resolve, reject) => {
      const subscription = context.subscribeDynamicValue<string>(dynamicValue, val => {
        if (val) values.push(val);
        if (values.length >= 3) {
          subscription.unsubscribe();
          try {
            assert.strictEqual(values[0], 'tick 0');
            assert.strictEqual(values[1], 'tick 1');
            assert.strictEqual(values[2], 'tick 2');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
      if (subscription.value) {
        values.push(subscription.value);
      }
    });
  });

  it('updates function output when arguments change', () => {
    const dataModel = new DataModel();
    const functions = new Map<string, Function>();

    functions.set('echo', (args: Record<string, any>) => {
      return `echo: ${args['val']}`;
    });

    const context = createTestDataContext(
      dataModel,
      '/',
      (name: string, args: any, _ctx: any, abortSignal?: AbortSignal) => {
        const fn = functions.get(name);
        return fn ? fn(args, abortSignal) : undefined;
      },
    );
    dataModel.set('/msg', 'hello');

    // echo(val: {path: '/msg'})
    const dynamicValue = {
      call: 'echo',
      args: {
        val: {path: '/msg'},
      },
      returnType: 'string' as const,
    };

    const values: string[] = [];
    return new Promise<void>((resolve, reject) => {
      const subscription = context.subscribeDynamicValue<string>(dynamicValue, val => {
        if (val) values.push(val);
        if (values.length === 2) {
          subscription.unsubscribe();
          try {
            assert.strictEqual(values[0], 'echo: hello');
            assert.strictEqual(values[1], 'echo: world');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
      if (subscription.value) {
        values.push(subscription.value);
      }

      // Change data after a short delay to ensure first emit happens
      setTimeout(() => {
        dataModel.set('/msg', 'world');
      }, 50);
    });
  });
});
