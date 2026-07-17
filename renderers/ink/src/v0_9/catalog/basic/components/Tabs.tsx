/**
 * Copyright 2026 kokoro-ele
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
import {Box, Text, useFocus, useInput} from 'ink';
import {type ComponentId} from '@a2ui/web_core/v0_9';
import {createComponentImplementation} from '../../../adapter.js';
import {TabsApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {weightProps} from '../utils.js';

interface ResolvedTab {
  title: unknown;
  child: ComponentId;
}

/** Terminal tabs. Focus the tab bar with Tab, then switch tabs with ←/→. */
export const Tabs = createComponentImplementation(TabsApi, ({props, buildChild}) => {
  const tabs: ResolvedTab[] = Array.isArray(props.tabs) ? props.tabs : [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const {isFocused} = useFocus();
  const activeTab = tabs[Math.min(selectedIndex, Math.max(tabs.length - 1, 0))];

  useInput(
    (_input, key) => {
      if (tabs.length === 0) return;
      if (key.leftArrow) {
        setSelectedIndex(i => (i - 1 + tabs.length) % tabs.length);
      } else if (key.rightArrow) {
        setSelectedIndex(i => (i + 1) % tabs.length);
      }
    },
    {isActive: isFocused},
  );

  return (
    <Box flexDirection="column" {...weightProps(props.weight)}>
      <Box flexDirection="row" gap={1}>
        {isFocused ? <Text color="cyan">‹</Text> : null}
        {tabs.map((tab, i) => {
          if (!tab) return null;
          return (
            <Text
              key={i}
              inverse={i === selectedIndex}
              color={i === selectedIndex ? 'cyan' : undefined}
              dimColor={i !== selectedIndex}
              bold={i === selectedIndex}
            >
              {` ${String(tab.title ?? `Tab ${i + 1}`)} `}
            </Text>
          );
        })}
        {isFocused ? <Text color="cyan">›</Text> : null}
      </Box>
      <Box borderStyle="single" borderColor={isFocused ? 'cyan' : 'gray'} paddingX={1}>
        {activeTab?.child ? buildChild(activeTab.child) : null}
      </Box>
    </Box>
  );
});
