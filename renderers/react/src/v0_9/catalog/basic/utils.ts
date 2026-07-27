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

import type React from 'react';
import {useEffect} from 'react';
import {injectBasicCatalogStyles} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Hook to automatically inject the web_core basic catalog styles.
 */
export const useBasicCatalogStyles = () => {
  useEffect(() => {
    if (typeof document !== 'undefined' && document.adoptedStyleSheets) {
      injectBasicCatalogStyles();
    }
  }, []);
};

export const mapJustify = (j?: string) => {
  switch (j) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'spaceAround':
      return 'space-around';
    case 'spaceBetween':
      return 'space-between';
    case 'spaceEvenly':
      return 'space-evenly';
    case 'start':
      return 'flex-start';
    case 'stretch':
      return 'stretch';
    default:
      return 'flex-start';
  }
};

export const mapAlign = (a?: string) => {
  switch (a) {
    case 'start':
      return 'flex-start';
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'stretch':
      return 'stretch';
    default:
      return 'stretch';
  }
};

export const getBaseLeafStyle = (): React.CSSProperties => ({
  boxSizing: 'border-box',
});

export const getBaseContainerStyle = (): React.CSSProperties => ({
  boxSizing: 'border-box',
});

// `min-width: 0` / `min-height: 0` let weighted children shrink below their
// intrinsic content size. Without them, a component with large content would
// force the container to overflow.
export const getWeightStyle = (weight?: number): React.CSSProperties => {
  if (typeof weight !== 'number') return {};
  return {flex: `${weight}`, minWidth: 0, minHeight: 0};
};
