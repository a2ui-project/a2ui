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

import {BridgeClient, BridgeError} from './bridge_client.js';
import {AppDataStore} from './data_store.js';

/** Phase of a `ui/error` notification (bridge protocol section 3.10). */
export type ErrorPhase = 'compile' | 'load' | 'render' | 'runtime' | 'bridge';

/** Fields of a `ui/error` notification besides the phase. */
export interface ErrorDetails {
  readonly message: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

/** The connection of one app document to its host: the bridge client and the data store. */
export class RuntimeSession {
  readonly store: AppDataStore;

  constructor(readonly client: BridgeClient) {
    this.store = new AppDataStore(
      {
        get: path => this.client.request('data/get', {path}),
        set: (path, value, seq) =>
          this.client.request<{seq: number; value?: unknown}>('data/set', {path, value, seq}),
        subscribe: path => this.client.request('data/subscribe', {path}),
      },
      (path, error) => {
        this.reportError('bridge', toErrorDetails(error, `Writing ${path} failed`));
      },
    );
    client.onNotification('data/changed', params => {
      const path = params['path'];
      if (typeof path === 'string') {
        this.store.applyRemote(path, Object.hasOwn(params, 'value'), params['value']);
      }
    });
  }

  /** Sends `ui/error` to the host. */
  reportError(phase: ErrorPhase, details: ErrorDetails): void {
    this.client.notify('ui/error', {phase, ...details});
  }
}

/** Turns anything thrown into the fields of a `ui/error`, prefixing `context` when given. */
export function toErrorDetails(error: unknown, context?: string): ErrorDetails {
  const base = error instanceof Error ? error.message : String(error);
  const message = context ? `${context}: ${base}` : base;
  const stack = error instanceof Error ? error.stack : undefined;
  return stack ? {message, stack} : {message};
}

let current: RuntimeSession | null = null;

/** Installs the session of this document; the runtime calls it once at start. */
export function setSession(session: RuntimeSession | null): void {
  current = session;
}

/**
 * The session of this document.
 *
 * @throws {BridgeError} When the runtime has not started, for example when the `a2ui` module is
 *   imported outside an app frame.
 */
export function getSession(): RuntimeSession {
  if (!current) {
    throw new BridgeError('The a2ui module is only available inside a ReactApp frame.', -32002);
  }
  return current;
}
