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

import {describe, expect, it} from 'vitest';
import {RateLimiter, toLoggable} from './diagnostics.js';

describe('RateLimiter', () => {
  it('allows `limit` events per second', () => {
    let time = 0;
    const limiter = new RateLimiter(2, () => time);

    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([
      true,
      true,
      false,
    ]);
    time = 1000;
    expect(limiter.tryAcquire()).toBe(true);
  });
});

describe('toLoggable', () => {
  it('keeps JSON values, summarizes errors and truncates deep or long values', () => {
    expect(toLoggable({a: [1, 'x', null, true]})).toEqual({a: [1, 'x', null, true]});
    expect(toLoggable(new TypeError('bad'))).toEqual({name: 'TypeError', message: 'bad'});
    expect(toLoggable({a: {b: {c: {d: 1}}}})).toEqual({a: {b: {c: '{…}'}}});
    expect((toLoggable('x'.repeat(3000)) as string).length).toBe(2001);
    expect(toLoggable(undefined)).toBe('undefined');
  });
});
