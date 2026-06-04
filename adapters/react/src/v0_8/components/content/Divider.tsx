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

/**
 * Divider component - renders a visual separator line.
 *
 * Structure mirrors Lit's Divider component:
 *   <div class="a2ui-divider">  ← :host equivalent
 *     <hr class="...">          ← internal element
 *   </div>
 */
export const Divider = memo(function Divider({
  node,
  surfaceId,
}: A2UIComponentProps<Types.DividerNode>) {
  const {theme} = useA2UIComponent(node, surfaceId);

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-divider" style={hostStyle}>
      <hr
        className={classMapToString(theme.components.Divider)}
        style={stylesToObject(theme.additionalStyles?.Divider)}
      />
    </div>
  );
});

export default Divider;
