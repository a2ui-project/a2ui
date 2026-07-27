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
import {CheckBoxApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const CheckBox = createComponentImplementation(CheckBoxApi, ({props}) => {
  useBasicCatalogStyles();
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.setValue(e.target.checked);
  };

  const uniqueId = React.useId();

  const hasError = props.validationErrors && props.validationErrors.length > 0;

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    margin: 'var(--a2ui-checkbox-margin, var(--a2ui-spacing-m))',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--a2ui-checkbox-gap, var(--a2ui-spacing-s, 0.5rem))',
  };

  const inputBaseStyle: React.CSSProperties = {
    cursor: 'pointer',
    width: 'var(--a2ui-checkbox-size, 1rem)',
    height: 'var(--a2ui-checkbox-size, 1rem)',
    background: 'var(--a2ui-checkbox-background, inherit)',
    border: 'var(--a2ui-checkbox-border, var(--a2ui-border))',
    borderRadius: 'var(--a2ui-checkbox-border-radius, 4px)',
    outline: 'none',
  };

  const inputErrorStyle: React.CSSProperties = {
    outline: '1px solid var(--a2ui-checkbox-color-error, red)',
  };

  const labelBaseStyle: React.CSSProperties = {
    cursor: 'pointer',
    color: 'var(--a2ui-color-on-surface, inherit)',
    fontSize:
      'var(--a2ui-checkbox-label-font-size, var(--a2ui-label-font-size, var(--a2ui-font-size-s)))',
    fontWeight: 'var(--a2ui-checkbox-label-font-weight, var(--a2ui-label-font-weight, bold))',
  };

  const labelErrorStyle: React.CSSProperties = {
    color: 'var(--a2ui-checkbox-color-error, red)',
  };

  const errorStyle: React.CSSProperties = {
    fontSize: 'var(--a2ui-font-size-xs, 0.75rem)',
    color: 'var(--a2ui-checkbox-color-error, red)',
    marginTop: '4px',
  };

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <input
          id={uniqueId}
          type="checkbox"
          checked={!!props.value}
          onChange={onChange}
          style={{
            ...inputBaseStyle,
            ...(hasError ? inputErrorStyle : {}),
          }}
        />
        {props.label && (
          <label
            htmlFor={uniqueId}
            style={{
              ...labelBaseStyle,
              ...(hasError ? labelErrorStyle : {}),
            }}
          >
            {props.label}
          </label>
        )}
      </div>
      {hasError && <span style={errorStyle}>{props.validationErrors?.[0]}</span>}
    </div>
  );
});
