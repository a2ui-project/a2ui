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

import {memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject} from '../../lib/utils';
import {ComponentNode} from '../../core/ComponentNode';

/**
 * Card component - a container that visually groups content.
 *
 * Structure mirrors Lit's Card component:
 *   <div class="a2ui-card">      ← :host equivalent
 *     <section class="...">      ← theme classes (border, padding, background)
 *       {children}               ← ::slotted(*) equivalent
 *     </section>
 *   </div>
 *
 * All styles come from componentSpecificStyles CSS, no inline styles needed.
 */
export const Card = memo(function Card({node, surfaceId}: A2UIComponentProps<Types.CardNode>) {
  const {theme} = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  // Card can have either a single child or multiple children
  const rawChildren = props.children ?? (props.child ? [props.child] : []);
  const children = Array.isArray(rawChildren) ? rawChildren : [];

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-card" style={hostStyle}>
      <section
        className={classMapToString(theme.components.Card)}
        style={stylesToObject(theme.additionalStyles?.Card)}
      >
        {children.map((child, index) => {
          const childId =
            typeof child === 'object' && child !== null && 'id' in child
              ? (child as Types.AnyComponentNode).id
              : `child-${index}`;
          const childNode =
            typeof child === 'object' && child !== null && 'type' in child
              ? (child as Types.AnyComponentNode)
              : null;
          return <ComponentNode key={childId} node={childNode} surfaceId={surfaceId} />;
        })}
      </section>
    </div>
  );
});

export default Card;
