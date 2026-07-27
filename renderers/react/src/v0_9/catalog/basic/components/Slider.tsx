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
import {SliderApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const Slider = createComponentImplementation(SliderApi, ({props}) => {
  useBasicCatalogStyles();
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.setValue(Number(e.target.value));
  };

  const uniqueId = React.useId();

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--a2ui-spacing-xs, 0.25rem)',
    margin: 'var(--a2ui-slider-margin, var(--a2ui-spacing-m))',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const labelStyle: React.CSSProperties = {
    fontSize:
      'var(--a2ui-slider-label-font-size, var(--a2ui-label-font-size, var(--a2ui-font-size-s)))',
    fontWeight: 'var(--a2ui-slider-label-font-weight, var(--a2ui-label-font-weight, bold))',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 'var(--a2ui-font-size-xs, 0.75rem)',
    color: 'var(--a2ui-text-caption-color, light-dark(#666, #aaa))',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    cursor: 'pointer',
    accentColor: 'var(--a2ui-slider-thumb-color, var(--a2ui-color-primary, #007bff))',
    background: 'var(--a2ui-slider-track-color, var(--a2ui-color-secondary, #e9ecef))',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        {props.label && (
          <label htmlFor={uniqueId} style={labelStyle}>
            {props.label}
          </label>
        )}
        <span style={valueStyle}>{props.value}</span>
      </div>
      <input
        id={uniqueId}
        type="range"
        min={props.min ?? 0}
        max={props.max}
        value={props.value ?? 0}
        onChange={onChange}
        style={inputStyle}
      />
    </div>
  );
});
