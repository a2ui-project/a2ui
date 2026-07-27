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

import {useCallback, useId, memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject} from '../../lib/utils';

/**
 * MultipleChoice component - a selection component using a dropdown.
 *
 * Renders a <select> element with options, matching the Lit renderer's behavior.
 * Supports two-way data binding for the selected value.
 */
export const MultipleChoice = memo(function MultipleChoice({
  node,
  surfaceId,
}: A2UIComponentProps<Types.MultipleChoiceNode>) {
  const {theme, resolveString, setValue} = useA2UIComponent(node, surfaceId);
  const props = node.properties;
  const id = useId();

  const options =
    (props.options as {label: {literalString?: string; path?: string}; value: string}[]) ?? [];
  const selectionsPath = props.selections?.path;

  // Access description from props (Lit component supports it)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const description = resolveString((props as any).description) ?? 'Select an item';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      // Two-way binding: update data model with array (matches Lit behavior)
      if (selectionsPath) {
        setValue(selectionsPath, [e.target.value]);
      }
    },
    [selectionsPath, setValue],
  );

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  // Structure mirrors Lit's MultipleChoice component:
  //   <div class="a2ui-multiplechoice">  ← :host equivalent
  //     <section class="...">            ← container theme classes
  //       <label>...</label>             ← description label
  //       <select>...</select>           ← dropdown element
  //     </section>
  //   </div>
  return (
    <div className="a2ui-multiplechoice" style={hostStyle}>
      <section className={classMapToString(theme.components.MultipleChoice.container)}>
        <label htmlFor={id} className={classMapToString(theme.components.MultipleChoice.label)}>
          {description}
        </label>
        <select
          name="data"
          id={id}
          className={classMapToString(theme.components.MultipleChoice.element)}
          style={stylesToObject(theme.additionalStyles?.MultipleChoice)}
          onChange={handleChange}
        >
          {options.map(option => {
            const label = resolveString(option.label);
            return (
              <option key={option.value} value={option.value}>
                {label}
              </option>
            );
          })}
        </select>
      </section>
    </div>
  );
});

export default MultipleChoice;
