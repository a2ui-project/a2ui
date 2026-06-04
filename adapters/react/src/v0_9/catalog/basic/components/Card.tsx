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
import {CardApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseContainerStyle, getWeightStyle, useBasicCatalogStyles} from '../utils';

export const Card = createComponentImplementation(CardApi, ({props, buildChild}) => {
  useBasicCatalogStyles();

  const style: React.CSSProperties = {
    ...getBaseContainerStyle(),
    ...getWeightStyle(props.weight),
    display: 'block',
    border: 'var(--a2ui-card-border, var(--a2ui-border))',
    borderRadius: 'var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px))',
    padding: 'var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px))',
    background: 'var(--a2ui-card-background, var(--a2ui-color-surface, #fff))',
    color: 'var(--a2ui-color-on-surface, #333)',
    boxShadow: 'var(--a2ui-card-box-shadow, 0 2px 4px rgba(0,0,0,0.1))',
    margin: 'var(--a2ui-card-margin, var(--a2ui-spacing-m))',
  };

  return <div style={style}>{props.child ? buildChild(props.child) : null}</div>;
});
