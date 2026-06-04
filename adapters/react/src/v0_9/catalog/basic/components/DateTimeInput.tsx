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
import {DateTimeInputApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const DateTimeInput = createComponentImplementation(DateTimeInputApi, ({props}) => {
  useBasicCatalogStyles();
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.setValue(e.target.value);
  };

  const uniqueId = React.useId();

  // Map enableDate/enableTime to input type
  let type = 'datetime-local';
  if (props.enableDate && !props.enableTime) type = 'date';
  if (!props.enableDate && props.enableTime) type = 'time';

  const style: React.CSSProperties = {
    backgroundColor: 'var(--a2ui-datetimeinput-background, var(--a2ui-color-input, #fff))',
    color: 'var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333))',
    border: 'var(--a2ui-datetimeinput-border, var(--a2ui-border))',
    borderRadius: 'var(--a2ui-datetimeinput-border-radius, var(--a2ui-border-radius))',
    padding: 'var(--a2ui-datetimeinput-padding, var(--a2ui-spacing-s))',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--a2ui-spacing-xs, 0.25rem)',
      }}
    >
      {props.label && (
        <label
          htmlFor={uniqueId}
          style={{
            fontSize:
              'var(--a2ui-datetimeinput-label-font-size, var(--a2ui-label-font-size, var(--a2ui-font-size-s)))',
            fontWeight:
              'var(--a2ui-datetimeinput-label-font-weight, var(--a2ui-label-font-weight, bold))',
          }}
        >
          {props.label}
        </label>
      )}
      <input
        id={uniqueId}
        type={type}
        style={style}
        value={props.value || ''}
        onChange={onChange}
        min={typeof props.min === 'string' ? props.min : undefined}
        max={typeof props.max === 'string' ? props.max : undefined}
      />
    </div>
  );
});
