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

import {useState} from 'react';
import {createComponentImplementation} from '../../../adapter';
import {TabsApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

// The type of a tab is deeply nested into the TabsApi schema, and
// it seems z.infer is not inferring it correctly (?). We use `any` for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _Tab = any;

export const Tabs = createComponentImplementation(TabsApi, ({props, buildChild}) => {
  useBasicCatalogStyles();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabs = props.tabs || [];
  const activeTab = tabs[selectedIndex];

  const tabsContainer: React.CSSProperties = {
    display: 'block',
  };

  const tabsHeaders: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--a2ui-spacing-xs, 0.25rem)',
    borderBottom:
      'var(--a2ui-tabs-border, var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc))',
    marginBottom: 'var(--a2ui-spacing-m, 0.5rem)',
  };

  const tabsHeaderBase: React.CSSProperties = {
    padding: 'var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem)',
    background: 'var(--a2ui-tabs-header-background, transparent)',
    color: 'var(--a2ui-tabs-header-color, var(--a2ui-color-on-surface))',
    border: 'none',
    borderRadius: 'var(--a2ui-border-radius, 0.25rem) var(--a2ui-border-radius, 0.25rem) 0 0',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const tabsHeaderActive: React.CSSProperties = {
    background: 'var(--a2ui-tabs-header-background-active, var(--a2ui-color-secondary, #eee))',
    color: 'var(--a2ui-tabs-header-color-active, var(--a2ui-color-on-secondary, #333))',
  };

  const content: React.CSSProperties = {
    padding: 'var(--a2ui-tabs-content-padding, 0 var(--a2ui-spacing-m, 0.5rem))',
  };

  return (
    <div style={tabsContainer}>
      <div style={tabsHeaders}>
        {tabs.map((tab: _Tab, i: number) => (
          <button
            key={i}
            onClick={() => setSelectedIndex(i)}
            style={{
              ...tabsHeaderBase,
              ...(selectedIndex === i ? tabsHeaderActive : {}),
            }}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div style={content}>{activeTab ? buildChild(activeTab.child) : null}</div>
    </div>
  );
});
