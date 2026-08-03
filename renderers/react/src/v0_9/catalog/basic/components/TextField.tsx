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

import React from 'react';
import {createComponentImplementation} from '../../../adapter';
import {TextFieldApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';
import styles from './TextField.module.css';

export const TextField = createComponentImplementation(TextFieldApi, ({props}) => {
  useBasicCatalogStyles();
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    props.setValue(e.target.value);
  };

  const isLong = props.variant === 'longText';
  const type =
    props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text';

  const uniqueId = React.useId();
  const descriptionId = `${uniqueId}-description`;
  const errorId = `${uniqueId}-error`;
  const hasDescription = !!props.accessibility?.description;
  const hasError = props.validationErrors && props.validationErrors.length > 0;

  const describedBy = [
    hasDescription ? descriptionId : null,
    hasError ? errorId : null,
  ].filter(Boolean).join(' ') || undefined;

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

  const inputClasses = `${styles.input} ${hasError ? styles.invalid : ''}`;

  return (
    <div className={styles.host}>
      {props.label && (
        <label htmlFor={uniqueId} className={styles.label}>
          {props.label}
        </label>
      )}
      {isLong ? (
        <textarea
          id={uniqueId}
          className={inputClasses}
          value={props.value || ''}
          onChange={onChange}
          aria-label={props.accessibility?.label}
          aria-invalid={hasError ? 'true' : 'false'}
          aria-describedby={describedBy}
        />
      ) : (
        <input
          id={uniqueId}
          type={type}
          className={inputClasses}
          value={props.value || ''}
          onChange={onChange}
          aria-label={props.accessibility?.label}
          aria-invalid={hasError ? 'true' : 'false'}
          aria-describedby={describedBy}
        />
      )}
      {hasError && (
        <span id={errorId} className={styles.error}>
          {props.validationErrors![0]}
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
