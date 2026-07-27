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
import {DividerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const Divider = createComponentImplementation(DividerApi, ({props}) => {
  useBasicCatalogStyles();
  const isVertical = props.axis === 'vertical';
  const style: React.CSSProperties = {
    border: 'none',
    backgroundColor: 'var(--a2ui-color-border, #ccc)',
  };

  if (isVertical) {
    style.width = 'var(--a2ui-border-width, 1px)';
    style.height = '100%';
    style.margin = '0 var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem))';
  } else {
    style.width = '100%';
    style.height = 'var(--a2ui-border-width, 1px)';
    style.margin = 'var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem)) 0';
  }

  return <div style={style} />;
});
