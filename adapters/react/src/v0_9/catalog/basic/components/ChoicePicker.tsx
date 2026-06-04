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
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';
import styles from './ChoicePicker.module.css';

// The type of an option is deeply nested into the ChoicePickerApi schema, and
// it seems z.infer is not inferring it correctly (?). We use `any` for now.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _Option = any;

export const ChoicePicker = createComponentImplementation(ChoicePickerApi, ({props, context}) => {
  useBasicCatalogStyles();
  const [filter, setFilter] = useState('');

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

  const listClasses = `${styles.options} ${props.displayStyle === 'chips' ? styles.chips : ''}`;

  return (
    <div className={styles.host}>
      {props.label && <strong className={styles.label}>{props.label}</strong>}
      {props.filterable && (
        <input
          type="text"
          placeholder="Filter options..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={styles.filterInput}
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
                className={`${styles.chip} ${isSelected ? styles.selected : ''}`}
                aria-pressed={isSelected}
              >
                {opt.label}
              </button>
            );
          }
          return (
            <label key={i} className={styles.optionLabel}>
              <input
                type={isMutuallyExclusive ? 'radio' : 'checkbox'}
                checked={isSelected}
                onChange={() => onToggle(opt.value)}
                name={isMutuallyExclusive ? `choice-${context.componentModel.id}` : undefined}
              />
              <span className={styles.optionText}>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
});
