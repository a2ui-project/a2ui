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

import React, {useState} from 'react';
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
  const uniqueId = React.useId();
  const descriptionId = `${uniqueId}-description`;
  const errorId = `${uniqueId}-error`;
  const hasDescription = !!props.accessibility?.description;
  const hasError = props.validationErrors && props.validationErrors.length > 0;

  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  const hiddenStyle: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    border: 0,
  };

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

  const errorStyle: React.CSSProperties = {
    fontSize: 'var(--a2ui-font-size-xs, 0.75rem)',
    color: 'var(--a2ui-color-error, red)',
    marginTop: '4px',
  };

  return (
    <div className={styles.host}>
      {props.label && (
        <strong id={`${uniqueId}-label`} className={styles.label}>
          {props.label}
        </strong>
      )}
      {props.filterable && (
        <input
          type="text"
          placeholder="Filter options..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={styles.filterInput}
        />
      )}
      <div
        className={listClasses}
        role={isMutuallyExclusive ? 'radiogroup' : 'group'}
        aria-labelledby={props.label ? `${uniqueId}-label` : undefined}
        aria-label={props.accessibility?.label}
        aria-invalid={hasError ? 'true' : 'false'}
        aria-describedby={describedBy}
      >
        {options.map((opt: _Option, i: number) => {
          const isSelected = values.includes(opt.value);
          const optId = `${uniqueId}-${i}`;
          if (props.displayStyle === 'chips') {
            return (
              <button
                key={i}
                onClick={() => onToggle(opt.value)}
                className={`${styles.chip} chip ${isSelected ? `${styles.selected} selected` : ''}`}
                aria-pressed={isSelected}
              >
                {opt.label}
              </button>
            );
          }
          return (
            <label key={i} htmlFor={optId} className={styles.optionLabel}>
              <input
                id={optId}
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
      {hasError && (
        <span id={errorId} style={errorStyle}>
          {props.validationErrors?.[0]}
        </span>
      )}
      {hasDescription && (
        <span id={descriptionId} style={hiddenStyle}>
          {props.accessibility?.description}
        </span>
      )}
    </div>
  );
});
