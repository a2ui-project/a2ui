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
import {ProgressBarApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const ProgressBar = createComponentImplementation(ProgressBarApi, ({props}) => {
  useBasicCatalogStyles();
  const isIndeterminate = (props.variant ?? 'determinate') === 'indeterminate';
  const max = props.max ?? 100;
  const pct = isIndeterminate ? 0 : Math.min(100, Math.max(0, ((props.value ?? 0) / max) * 100));

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--a2ui-spacing-xs, 0.25rem)',
    margin: 'var(--a2ui-progress-bar-margin, var(--a2ui-spacing-m))',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const labelStyle: React.CSSProperties = {
    fontSize:
      'var(--a2ui-progress-bar-label-font-size, var(--a2ui-label-font-size, var(--a2ui-font-size-s)))',
    fontWeight: 'var(--a2ui-progress-bar-label-font-weight, var(--a2ui-label-font-weight, bold))',
  };

  const percentageStyle: React.CSSProperties = {
    fontSize: 'var(--a2ui-progress-bar-percentage-font-size, var(--a2ui-font-size-xs, 0.75rem))',
    color: 'var(--a2ui-progress-bar-percentage-color, var(--a2ui-text-caption-color, light-dark(#666, #aaa)))',
  };

  const trackStyle: React.CSSProperties = {
    width: '100%',
    height: 'var(--a2ui-progress-bar-height, 0.5rem)',
    background: 'var(--a2ui-progress-bar-track-color, var(--a2ui-color-secondary, #e9ecef))',
    borderRadius: 'var(--a2ui-progress-bar-border-radius, 0.25rem)',
    overflow: 'hidden',
  };

  const fillStyle: React.CSSProperties = {
    height: '100%',
    width: isIndeterminate ? '30%' : `${pct}%`,
    background: 'var(--a2ui-progress-bar-fill-color, var(--a2ui-color-primary, #007bff))',
    borderRadius: 'var(--a2ui-progress-bar-border-radius, 0.25rem)',
    transition: 'width 0.3s ease',
    ...(isIndeterminate
      ? {
          animation: 'a2ui-progress-indeterminate 1.5s ease-in-out infinite',
        }
      : {}),
  };

  const keyframesStyle = `
    @keyframes a2ui-progress-indeterminate {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
  `;

  return (
    <div style={containerStyle}>
      <style>{keyframesStyle}</style>
      <div style={headerStyle}>
        {props.label && <label style={labelStyle}>{props.label}</label>}
        {(props.showPercentage ?? true) && !isIndeterminate && (
          <span style={percentageStyle}>{Math.round(pct)}%</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={trackStyle}
      >
        <div style={fillStyle} />
      </div>
    </div>
  );
});
