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
import {AudioPlayerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {useBasicCatalogStyles} from '../utils';

export const AudioPlayer = createComponentImplementation(AudioPlayerApi, ({props}) => {
  useBasicCatalogStyles();
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--a2ui-spacing-xs, 0.25rem)',
    background: 'var(--a2ui-audioplayer-background, transparent)',
    borderRadius: 'var(--a2ui-audioplayer-border-radius, 0)',
    padding: 'var(--a2ui-audioplayer-padding, 0)',
  };

  return (
    <div style={containerStyle}>
      {props.description && (
        <span
          style={{
            fontSize: 'var(--a2ui-font-size-xs, 0.75rem)',
            color: 'var(--a2ui-text-caption-color, light-dark(#666, #aaa))',
          }}
        >
          {props.description}
        </span>
      )}
      <audio src={props.url} controls />
    </div>
  );
});
