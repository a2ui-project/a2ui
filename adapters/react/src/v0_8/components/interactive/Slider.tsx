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
 * Slider component - a numeric value selector with a range.
 *
 * Supports two-way data binding for the value.
 */
export const Slider = memo(function Slider({
  node,
  surfaceId,
}: A2UIComponentProps<Types.SliderNode>) {
  const {theme, resolveNumber, resolveString, setValue, getValue} = useA2UIComponent(
    node,
    surfaceId,
  );
  const props = node.properties;
  const id = useId();

  const valuePath = props.value?.path;
  const initialValue = resolveNumber(props.value) ?? 0;
  // Match Lit's default values (minValue=0, maxValue=0)
  const minValue = props.minValue ?? 0;
  const maxValue = props.maxValue ?? 0;

  const [value, setLocalValue] = useState(initialValue);

  // Sync with external data model changes (path binding)
  useEffect(() => {
    if (valuePath) {
      const externalValue = getValue(valuePath);
      if (externalValue !== null && Number(externalValue) !== value) {
        setLocalValue(Number(externalValue));
      }
    }
  }, [valuePath, getValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when literal value changes from props (server-driven updates via surfaceUpdate)
  useEffect(() => {
    if (props.value?.literalNumber !== undefined) {
      setLocalValue(props.value.literalNumber);
    }
  }, [props.value?.literalNumber]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      setLocalValue(newValue);

      // Two-way binding: update data model
      if (valuePath) {
        setValue(valuePath, newValue);
      }
    },
    [valuePath, setValue],
  );

  // Access label from props if it exists (Lit component supports it but type doesn't define it)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelValue = (props as any).label;
  const label = labelValue ? resolveString(labelValue) : '';

  // Structure mirrors Lit's Slider component:
  //   <div class="a2ui-slider">    ← :host equivalent
  //     <section class="...">      ← internal element
  //       <label>...</label>
  //       <input>...</input>
  //       <span>value</span>
  //     </section>
  //   </div>

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-slider" style={hostStyle}>
      <section className={classMapToString(theme.components.Slider.container)}>
        {label && (
          <label htmlFor={id} className={classMapToString(theme.components.Slider.label)}>
            {label}
          </label>
        )}
        <input
          type="range"
          id={id}
          name="data"
          value={value}
          min={minValue}
          max={maxValue}
          onChange={handleChange}
          className={classMapToString(theme.components.Slider.element)}
          style={stylesToObject(theme.additionalStyles?.Slider)}
        />
        <span className={classMapToString(theme.components.Slider.label)}>{value}</span>
      </section>
    </div>
  );
});

export default Slider;
