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

import {useState, useCallback, useEffect, useId, memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject} from '../../lib/utils';

/**
 * CheckBox component - a boolean toggle with a label.
 *
 * Supports two-way data binding for the checked state.
 */
export const CheckBox = memo(function CheckBox({
  node,
  surfaceId,
}: A2UIComponentProps<Types.CheckboxNode>) {
  const {theme, resolveString, resolveBoolean, setValue, getValue} = useA2UIComponent(
    node,
    surfaceId,
  );
  const props = node.properties;
  const id = useId();

  const label = resolveString(props.label);
  const valuePath = props.value?.path;
  const initialChecked = resolveBoolean(props.value) ?? false;

  const [checked, setChecked] = useState(initialChecked);

  // Sync with external data model changes (path binding)
  useEffect(() => {
    if (valuePath) {
      const externalValue = getValue(valuePath);
      if (externalValue !== null && Boolean(externalValue) !== checked) {
        setChecked(Boolean(externalValue));
      }
    }
  }, [valuePath, getValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when literal value changes from props (server-driven updates via surfaceUpdate)
  useEffect(() => {
    if (props.value?.literalBoolean !== undefined) {
      setChecked(props.value.literalBoolean);
    }
  }, [props.value?.literalBoolean]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.checked;
      setChecked(newValue);

      // Two-way binding: update data model
      if (valuePath) {
        setValue(valuePath, newValue);
      }
    },
    [valuePath, setValue],
  );

  // Structure mirrors Lit's CheckBox component:
  //   <div class="a2ui-checkbox">  ← :host equivalent
  //     <section class="...">      ← internal element
  //       <input>...</input>
  //       <label>...</label>
  //     </section>
  //   </div>

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-checkbox" style={hostStyle}>
      <section
        className={classMapToString(theme.components.CheckBox.container)}
        style={stylesToObject(theme.additionalStyles?.CheckBox)}
      >
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={handleChange}
          className={classMapToString(theme.components.CheckBox.element)}
        />
        {label && (
          <label htmlFor={id} className={classMapToString(theme.components.CheckBox.label)}>
            {label}
          </label>
        )}
      </section>
    </div>
  );
});

export default CheckBox;
