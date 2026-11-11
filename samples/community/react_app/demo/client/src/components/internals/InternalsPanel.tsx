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

import {useState} from 'react';
import type {DemoSession, TurnState} from '../../services/session';
import {BridgeTab} from './BridgeTab';
import {DataModelTab} from './DataModelTab';
import {ExpressTab} from './ExpressTab';
import {JsonTab} from './JsonTab';
import {PerformanceTab} from './PerformanceTab';
import {SourceTab} from './SourceTab';

const TABS = [
  {id: 'express', label: 'Express'},
  {id: 'json', label: 'A2UI JSON'},
  {id: 'source', label: 'React source'},
  {id: 'bridge', label: 'Bridge'},
  {id: 'data', label: 'Data model'},
  {id: 'performance', label: 'Performance'},
] as const;

type TabId = (typeof TABS)[number]['id'];

/** The tabs of a turn's "How this was built" panel. */
export function InternalsPanel({turn, session}: {turn: TurnState; session: DemoSession}) {
  const [tab, setTab] = useState<TabId>('express');
  const panelId = `${turn.id}-internals`;
  return (
    <div className="internals-panel">
      <div className="tabs" role="tablist" aria-label="How this was built">
        {TABS.map(({id, label}) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${panelId}-${id}`}
            className="tab"
            aria-selected={tab === id}
            aria-controls={`${panelId}-panel`}
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="tab-panel"
        role="tabpanel"
        id={`${panelId}-panel`}
        aria-labelledby={`${panelId}-${tab}`}
        data-testid={`tabpanel-${tab}`}
      >
        {tab === 'express' && <ExpressTab turn={turn} />}
        {tab === 'json' && <JsonTab turn={turn} />}
        {tab === 'source' && <SourceTab turn={turn} />}
        {tab === 'bridge' && <BridgeTab log={session.bridgeLog(turn.id)} />}
        {tab === 'data' && <DataModelTab turn={turn} session={session} />}
        {tab === 'performance' && <PerformanceTab turn={turn} session={session} />}
      </div>
    </div>
  );
}
