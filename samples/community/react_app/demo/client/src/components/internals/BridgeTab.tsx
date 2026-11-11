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

import {useMemo, useState, useSyncExternalStore} from 'react';
import type {BridgeEntry, BridgeLog} from '../../services/bridge_log';
import {TabEmpty} from './Code';

const FILTERS = [
  {id: 'all', label: 'All'},
  {id: 'data', label: 'Data'},
  {id: 'function', label: 'Functions'},
  {id: 'action', label: 'Actions'},
  {id: 'ui', label: 'UI'},
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

/** The family a row belongs to, for the filter chips. */
function family(entry: BridgeEntry): FilterId {
  const method = entry.request?.method ?? entry.method;
  if (method.startsWith('data/') || method === 'reactApp/initialize') {
    return 'data';
  }
  if (method.startsWith('function/')) {
    return 'function';
  }
  if (method.startsWith('action/')) {
    return 'action';
  }
  return 'ui';
}

/** A short, readable description of a row's payload. */
function describe(entry: BridgeEntry): string {
  const payload = entry.payload as Record<string, unknown> | null;
  if (entry.direction === 'lifecycle') {
    if (entry.method === 'rendered') {
      const ms = (payload as {frameReadyToRenderedMs?: number} | null)?.frameReadyToRenderedMs;
      return ms !== undefined ? `frame ready → rendered in ${Math.round(ms)} ms` : '';
    }
    if (entry.method === 'error') {
      return String((payload as {error?: {message?: string}} | null)?.error?.message ?? '');
    }
    return '';
  }
  if (!payload || typeof payload !== 'object') {
    return payload === null ? '' : JSON.stringify(payload);
  }
  if (entry.method === 'function/call') {
    return `${String(payload['name'])}(${truncate(JSON.stringify(payload['args'] ?? {}), 70)})`;
  }
  if (typeof payload['path'] === 'string') {
    const value = 'value' in payload ? ` = ${truncate(JSON.stringify(payload['value']), 60)}` : '';
    return `${payload['path']}${value}`;
  }
  if (entry.method === 'reactApp/initialize') {
    const paths = payload['paths'];
    return Array.isArray(paths) ? `paths ${paths.join(', ')}` : '';
  }
  return truncate(JSON.stringify(payload), 90);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The live `postMessage` traffic between the page and the turn's app frames. */
export function BridgeTab({log}: {log: BridgeLog}) {
  const entries = useSyncExternalStore(log.subscribe, log.getEntries);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const start = entries[0]?.time ?? 0;
  const visible = useMemo(
    () =>
      entries.filter(
        entry =>
          (filter === 'all' || family(entry) === filter) &&
          (!query ||
            `${entry.method} ${entry.request?.method ?? ''} ${describe(entry)}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [entries, filter, query],
  );
  const calls = entries.filter(entry => entry.request?.method === 'function/call');

  if (entries.length === 0) {
    return <TabEmpty>No bridge traffic yet. It starts when a ReactApp loads.</TabEmpty>;
  }
  return (
    <div className="tab-stack">
      <p className="tab-caption">
        JSON-RPC over <code>postMessage</code>, relayed by the sandbox proxy. Move a native control
        or use the app and watch rows arrive.{' '}
        {calls.length > 0 &&
          `${calls.length} function call${calls.length === 1 ? '' : 's'}, median ${median(
            calls.map(c => c.request!.durationMs),
          ).toFixed(0)} ms.`}
      </p>
      <div className="bridge-tools">
        <div className="filter-chips" role="group" aria-label="Filter by kind">
          {FILTERS.map(({id, label}) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="bridge-search"
          placeholder="Filter rows"
          aria-label="Filter rows"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      <div className="bridge-table" role="table" aria-label="Bridge messages">
        {visible.map(entry => (
          <div
            key={entry.seq}
            className={`bridge-row bridge-${entry.direction === 'lifecycle' ? 'life' : entry.direction === 'app→host' ? 'up' : 'down'}`}
            role="row"
            data-testid="bridge-row"
            data-method={entry.request?.method ?? entry.method}
          >
            <span className="bridge-time" role="cell">
              +{Math.round(entry.time - start)}
            </span>
            <span className="bridge-dir" role="cell">
              {entry.direction}
            </span>
            <span className="bridge-method" role="cell">
              {entry.request ? `${entry.request.method} ↩` : entry.method}
            </span>
            <span className="bridge-detail" role="cell">
              {describe(entry)}
            </span>
            <span className="bridge-ms" role="cell">
              {entry.request ? `${entry.request.durationMs.toFixed(0)} ms` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
