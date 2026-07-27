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

import {useState, memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject, mergeClassMaps} from '../../lib/utils';
import {ComponentNode} from '../../core/ComponentNode';

/**
 * Tabs component - displays content in switchable tabs.
 */
export const Tabs = memo(function Tabs({node, surfaceId}: A2UIComponentProps<Types.TabsNode>) {
  const {theme, resolveString} = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabItems = props.tabItems ?? [];

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-tabs" style={hostStyle}>
      <section
        className={classMapToString(theme.components.Tabs.container)}
        style={stylesToObject(theme.additionalStyles?.Tabs)}
      >
        {/* Tab buttons - uses Tabs.element for the container */}
        <div id="buttons" className={classMapToString(theme.components.Tabs.element)}>
          {tabItems.map((tab, index) => {
            const title = resolveString(tab.title);
            const isSelected = index === selectedIndex;

            // Lit merges all + selected classes when selected
            const classes = isSelected
              ? mergeClassMaps(
                  theme.components.Tabs.controls.all,
                  theme.components.Tabs.controls.selected,
                )
              : theme.components.Tabs.controls.all;

            return (
              <button
                key={index}
                disabled={isSelected}
                className={classMapToString(classes)}
                onClick={() => setSelectedIndex(index)}
              >
                {title}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tabItems[selectedIndex] && (
          <ComponentNode node={tabItems[selectedIndex].child} surfaceId={surfaceId} />
        )}
      </section>
    </div>
  );
});

export default Tabs;
