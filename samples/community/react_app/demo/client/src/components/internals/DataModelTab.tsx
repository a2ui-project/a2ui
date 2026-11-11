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

import {useEffect, useState, useSyncExternalStore} from 'react';
import {writtenPaths} from '../../services/bridge_log';
import type {DemoSession, TurnState} from '../../services/session';
import {TabEmpty} from './Code';

const POLL_MS = 300;

/** Re-reads the surfaces' data models while the tab is open, as JSON text to compare cheaply. */
function useDataSnapshot(session: DemoSession, surfaceIds: readonly string[]): string {
  const read = () =>
    JSON.stringify(
      Object.fromEntries(
        surfaceIds.map(id => [id, session.processor.model.getSurface(id)?.dataModel.get('/')]),
      ),
    );
  const [snapshot, setSnapshot] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setSnapshot(read), POLL_MS);
    return () => clearInterval(timer);
    // `read` only closes over the props below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, surfaceIds]);
  return snapshot;
}

/** A live JSON tree of the turn's data models. Paths the app wrote are highlighted. */
export function DataModelTab({turn, session}: {turn: TurnState; session: DemoSession}) {
  const log = session.bridgeLog(turn.id);
  const entries = useSyncExternalStore(log.subscribe, log.getEntries);
  const snapshot = useDataSnapshot(session, turn.surfaceIds);
  if (turn.surfaceIds.length === 0) {
    return <TabEmpty>This turn has no surface, so it has no data model.</TabEmpty>;
  }
  const written = new Set(writtenPaths(entries));
  const models = JSON.parse(snapshot) as Record<string, unknown>;
  return (
    <div className="tab-stack">
      <p className="tab-caption">
        Each surface&apos;s data model, live. Native components and the app share it;{' '}
        <mark className="written-key">highlighted</mark> paths were last written from inside the app
        frame.
      </p>
      {Object.entries(models).map(([surfaceId, value]) => (
        <section key={surfaceId} className="tree" data-testid="data-model-tree">
          <p className="tree-title">surface {surfaceId}</p>
          <JsonNode name="/" value={value} path="" written={written} depth={0} />
        </section>
      ))}
    </div>
  );
}

interface JsonNodeProps {
  name: string;
  value: unknown;
  path: string;
  written: ReadonlySet<string>;
  depth: number;
}

function JsonNode({name, value, path, written, depth}: JsonNodeProps) {
  const [open, setOpen] = useState(depth < 3);
  const isWritten = written.has(path);
  const label = (
    <span className={`tree-key${isWritten ? ' written-key' : ''}`} title={path || '/'}>
      {name}
    </span>
  );
  if (value === null || typeof value !== 'object') {
    return (
      <div className="tree-leaf" data-path={path}>
        {label}
        <span className={`tree-value tree-${value === null ? 'null' : typeof value}`}>
          {JSON.stringify(value)}
        </span>
      </div>
    );
  }
  const children = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${children.length}]` : `{${children.length}}`;
  return (
    <div className="tree-branch" data-path={path}>
      <button
        type="button"
        className="tree-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span className="tree-summary">{summary}</span>
      </button>
      {open && (
        <div className="tree-children">
          {children.slice(0, 200).map(([key, child]) => (
            <JsonNode
              key={key}
              name={key}
              value={child}
              path={`${path}/${key}`}
              written={written}
              depth={depth + 1}
            />
          ))}
          {children.length > 200 && <p className="tree-more">{children.length - 200} more…</p>}
        </div>
      )}
    </div>
  );
}
