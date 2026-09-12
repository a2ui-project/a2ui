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

import React from 'react';
import {createComponentImplementation} from '../../../adapter';
import {TextFieldApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const TextField = createComponentImplementation(TextFieldApi, ({props}) => {
  useBasicCatalogStyles();
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    props.setValue(e.target.value);
  };

  const isLong = props.variant === 'longText';
  const type =
    props.variant === 'number' ? 'number' : props.variant === 'obscured' ? 'password' : 'text';

  const uniqueId = React.useId();
  const hasError = props.validationErrors && props.validationErrors.length > 0;
  const inputClasses = `a2ui-field-input${hasError ? ' invalid' : ''}`;

  return (
    <div className="a2ui-text-field-container">
      {props.label && (
        <label htmlFor={uniqueId} className="a2ui-field-label">
          {props.label}
        </label>
      )}
      {isLong ? (
        <textarea
          id={uniqueId}
          className={inputClasses}
          value={props.value || ''}
          onChange={onChange}
        />
      ) : (
        <input
          id={uniqueId}
          type={type}
          className={inputClasses}
          value={props.value || ''}
          onChange={onChange}
        />
      )}
      {hasError && <span className="a2ui-error-message">{props.validationErrors![0]}</span>}
    </div>
  );
});
