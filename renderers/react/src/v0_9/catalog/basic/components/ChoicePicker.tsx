/*
 * Copyright 2024 Google LLC
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

import React, {useState} from 'react';
import {createComponentImplementation} from '../../../adapter';
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

// The type of an option is deeply nested into the ChoicePickerApi schema, and
// it seems z.infer is not inferring it correctly (?). We use `any` for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _Option = any;

export const ChoicePicker = createComponentImplementation(ChoicePickerApi, ({props}) => {
  useBasicCatalogStyles();
  const [filter, setFilter] = useState('');
  // Radio group names are document-scoped while component ids are only
  // surface-scoped, so the group name must be unique per rendered instance.
  const groupName = React.useId();

  const values = Array.isArray(props.value) ? props.value : [];
  const isMutuallyExclusive = props.variant === 'mutuallyExclusive';

  const onToggle = (val: string) => {
    if (isMutuallyExclusive) {
      props.setValue([val]);
    } else {
      const newValues = values.includes(val)
        ? values.filter((v: string) => v !== val)
        : [...values, val];
      props.setValue(newValues);
    }
  };

  const options = (props.options || []).filter(
    (opt: _Option) =>
      !props.filterable ||
      filter === '' ||
      String(opt.label).toLowerCase().includes(filter.toLowerCase()),
  );

  const listClasses = `a2ui-options-group${props.displayStyle === 'chips' ? ' a2ui-chips-group' : ''}`;

  return (
    <div className="a2ui-choice-picker">
      {props.label && <strong className="a2ui-field-label">{props.label}</strong>}
      {props.filterable && (
        <input
          type="text"
          placeholder="Filter options..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="a2ui-filter-input"
        />
      )}
      <div className={listClasses}>
        {options.map((opt: _Option, i: number) => {
          const isSelected = values.includes(opt.value);
          if (props.displayStyle === 'chips') {
            return (
              <button
                key={i}
                onClick={() => onToggle(opt.value)}
                className={`a2ui-chip chip${isSelected ? ' selected' : ''}`}
                aria-pressed={isSelected}
              >
                {opt.label}
              </button>
            );
          }
          return (
            <label key={i} className="a2ui-option-label">
              <input
                type={isMutuallyExclusive ? 'radio' : 'checkbox'}
                checked={isSelected}
                onChange={() => onToggle(opt.value)}
                name={isMutuallyExclusive ? groupName : undefined}
              />
              <span className="a2ui-option-text">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
});
