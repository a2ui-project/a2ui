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

import type {BridgeClient} from './bridge_client.js';
import {cspViolationMessage} from './error_messages.js';
import {toErrorDetails, type RuntimeSession} from './session.js';

/** Most `ui/log` and `ui/error` messages sent per second (bridge protocol section 8). */
export const MAX_DIAGNOSTICS_PER_SECOND = 50;

/** Most `csp` errors sent per second; a repeat of a violation already reported isn't sent. */
export const MAX_CSP_ERRORS_PER_SECOND = 5;

/** Allows `limit` events per fixed one-second window. */
export class RateLimiter {
  private windowStart = 0;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Whether one more event fits in the current second. */
  tryAcquire(): boolean {
    const time = this.clock();
    if (time - this.windowStart >= 1000) {
      this.windowStart = time;
      this.count = 0;
    }
    if (this.count >= this.limit) {
      return false;
    }
    this.count++;
    return true;
  }
}

/** Makes a logged value JSON-safe and small. */
export function toLoggable(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {name: value.name, message: value.message};
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (depth >= 3) {
    return Array.isArray(value) ? '[…]' : '{…}';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => toLoggable(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    out[key] = toLoggable(item, depth + 1);
  }
  return out;
}

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Forwards the app's `console` calls to the host as `ui/log`, and still logs them locally. */
export function forwardConsole(client: BridgeClient, target: Console = console): void {
  const limiter = new RateLimiter(MAX_DIAGNOSTICS_PER_SECOND);
  const methods: Record<(typeof LEVELS)[number], 'debug' | 'info' | 'warn' | 'error'> = {
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
  };
  for (const level of LEVELS) {
    const original = target[methods[level]].bind(target);
    target[methods[level]] = (...args: unknown[]) => {
      original(...args);
      if (limiter.tryAcquire()) {
        client.notify('ui/log', {level, args: args.map(arg => toLoggable(arg))});
      }
    };
  }
  const originalLog = target.log.bind(target);
  target.log = (...args: unknown[]) => {
    originalLog(...args);
    if (limiter.tryAcquire()) {
      client.notify('ui/log', {level: 'info', args: args.map(arg => toLoggable(arg))});
    }
  };
}

/** Reports uncaught errors and unhandled rejections as `ui/error` with phase `runtime`. */
export function watchUncaughtErrors(session: RuntimeSession, target: Window = window): void {
  const limiter = new RateLimiter(MAX_DIAGNOSTICS_PER_SECOND);
  target.addEventListener('error', event => {
    if (limiter.tryAcquire()) {
      session.reportError('runtime', toErrorDetails(event.error ?? event.message));
    }
  });
  target.addEventListener('unhandledrejection', event => {
    if (limiter.tryAcquire()) {
      session.reportError('runtime', toErrorDetails(event.reason, 'Unhandled rejection'));
    }
  });
}

/**
 * Reports content security policy violations as `ui/error` with phase `csp`, so a blocked `fetch`
 * or remote script reaches the host instead of only the frame's console. Each distinct
 * violation (directive and blocked URI) is reported once.
 */
export function watchCspViolations(session: RuntimeSession, target: Document = document): void {
  const limiter = new RateLimiter(MAX_CSP_ERRORS_PER_SECOND);
  const reported = new Set<string>();
  target.addEventListener('securitypolicyviolation', event => {
    const directive = event.effectiveDirective || event.violatedDirective;
    const blockedUri = event.blockedURI || 'inline';
    const key = `${directive} ${blockedUri}`;
    if (reported.has(key) || !limiter.tryAcquire()) {
      return;
    }
    reported.add(key);
    session.reportError('csp', {
      message: cspViolationMessage(directive, blockedUri),
      blockedUri,
      directive,
    });
  });
}
