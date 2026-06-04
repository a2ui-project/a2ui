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

type TextFieldType = 'shortText' | 'longText' | 'number' | 'date';

/**
 * TextField component - an input field for text entry.
 *
 * Supports various input types and two-way data binding.
 */
export const TextField = memo(function TextField({
  node,
  surfaceId,
}: A2UIComponentProps<Types.TextFieldNode>) {
  const {theme, resolveString, setValue, getValue} = useA2UIComponent(node, surfaceId);
  const props = node.properties;
  const id = useId();

  const label = resolveString(props.label);
  const textPath = props.text?.path;
  const initialValue = resolveString(props.text) ?? '';
  const propsRecord = props as Record<string, unknown>;
  const fieldType = (propsRecord.textFieldType || propsRecord.type) as TextFieldType;
  const validationRegexp = props.validationRegexp;

  const [value, setLocalValue] = useState(initialValue);
  // Validation state tracked for potential future use (e.g., error styling)
  const [_isValid, setIsValid] = useState(true);

  // Sync with external data model changes
  useEffect(() => {
    if (textPath) {
      const externalValue = getValue(textPath);
      if (externalValue !== null && String(externalValue) !== value) {
        setLocalValue(String(externalValue));
      }
    }
  }, [textPath, getValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Validate if pattern provided
      if (validationRegexp) {
        setIsValid(new RegExp(validationRegexp).test(newValue));
      }

      // Two-way binding: update data model
      if (textPath) {
        setValue(textPath, newValue);
      }
    },
    [validationRegexp, textPath, setValue],
  );

  const inputType = fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text';
  const isTextArea = fieldType === 'longText';

  // Structure mirrors Lit's TextField component:
  //   <div class="a2ui-textfield">  ← :host equivalent
  //     <section class="...">       ← container with theme classes
  //       <label>...</label>
  //       <input>...</input>
  //     </section>
  //   </div>

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-textfield" style={hostStyle}>
      <section className={classMapToString(theme.components.TextField.container)}>
        {label && (
          <label htmlFor={id} className={classMapToString(theme.components.TextField.label)}>
            {label}
          </label>
        )}
        {isTextArea ? (
          <textarea
            id={id}
            value={value}
            onChange={handleChange}
            placeholder="Please enter a value"
            className={classMapToString(theme.components.TextField.element)}
            style={stylesToObject(theme.additionalStyles?.TextField)}
          />
        ) : (
          <input
            type={inputType}
            id={id}
            value={value}
            onChange={handleChange}
            placeholder="Please enter a value"
            className={classMapToString(theme.components.TextField.element)}
            style={stylesToObject(theme.additionalStyles?.TextField)}
          />
        )}
      </section>
    </div>
  );
});

export default TextField;
