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
import {ImageApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle, getWeightStyle, useBasicCatalogStyles} from '../utils';

export const Image = createComponentImplementation(ImageApi, ({props}) => {
  useBasicCatalogStyles();
  const mapFit = (fit?: string): React.CSSProperties['objectFit'] => {
    if (fit === 'scaleDown') return 'scale-down';
    return (fit as React.CSSProperties['objectFit']) || 'fill';
  };

  const style: React.CSSProperties = {
    ...getBaseLeafStyle(),
    ...getWeightStyle(props.weight),
    objectFit: mapFit(props.fit),
    display: 'block',
    borderRadius: 'var(--a2ui-image-border-radius, 0)',
  };

  if (props.variant === 'icon') {
    style.width = 'var(--a2ui-image-icon-size, 24px)';
    style.height = 'var(--a2ui-image-icon-size, 24px)';
  } else if (props.variant === 'avatar') {
    style.width = 'var(--a2ui-image-avatar-size, 40px)';
    style.height = 'var(--a2ui-image-avatar-size, 40px)';
    style.borderRadius = '50%';
  } else if (props.variant === 'smallFeature') {
    style.maxWidth = 'var(--a2ui-image-small-feature-size, 100px)';
  } else if (props.variant === 'largeFeature') {
    style.maxHeight = 'var(--a2ui-image-large-feature-size, 400px)';
  } else if (props.variant === 'header') {
    style.height = 'var(--a2ui-image-header-size, 200px)';
    style.objectFit = 'cover';
  }

  return <img src={props.url} alt={props.description || ''} style={style} />;
});
