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

import {describe, expect, it, vi} from 'vitest';

import {RateLimiter, toLoggable, watchCspViolations} from './diagnostics.js';
import type {RuntimeSession} from './session.js';

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

describe('watchCspViolations', () => {
  function violation(effectiveDirective: string, blockedURI: string): Event {
    return Object.assign(new Event('securitypolicyviolation'), {
      effectiveDirective,
      violatedDirective: effectiveDirective,
      blockedURI,
    });
  }

  it('reports each distinct violation once as a csp error, at most 5 per second', () => {
    const reportError = vi.fn();
    const target = document.implementation.createHTMLDocument('csp');
    watchCspViolations({reportError} as unknown as RuntimeSession, target);

    target.dispatchEvent(violation('connect-src', 'https://api.example/price'));
    target.dispatchEvent(violation('connect-src', 'https://api.example/price'));
    for (let index = 0; index < 10; index++) {
      target.dispatchEvent(violation('img-src', `https://img.example/${index}.png`));
    }

    expect(reportError).toHaveBeenCalledTimes(5);
    expect(reportError.mock.calls[0]).toEqual([
      'csp',
      {
        message: expect.stringMatching(
          /^The content security policy blocked https:\/\/api\.example\/price \(connect-src\)\./,
        ),
        blockedUri: 'https://api.example/price',
        directive: 'connect-src',
      },
    ]);
  });
});
