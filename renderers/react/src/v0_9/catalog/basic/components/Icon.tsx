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
import {IconApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {getBaseLeafStyle, useBasicCatalogStyles} from '../utils';

const ICON_NAME_OVERRIDES: Record<string, string> = {
  play: 'play_arrow',
  rewind: 'fast_rewind',
  favoriteOff: 'favorite_border',
  starOff: 'star_border',
};

/**
 * Convert camelCase to snake_case for Material Symbols font.
 * e.g., "shoppingCart" -> "shopping_cart", "skipPrevious" -> "skip_previous"
 */
function toMaterialSymbol(str: string): string {
  return ICON_NAME_OVERRIDES[str] ?? str.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

export const Icon = createComponentImplementation(IconApi, ({props}) => {
  useBasicCatalogStyles();

  const isPath = typeof props.name === 'object' && props.name !== null && 'svgPath' in props.name;

  const baseStyle: React.CSSProperties = {
    ...getBaseLeafStyle(),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--a2ui-icon-size, var(--a2ui-font-size-xl, 24px))',
    color: 'var(--a2ui-icon-color, inherit)',
    lineHeight: 1,
  };

  if (isPath) {
    const path = (props.name as {svgPath: string}).svgPath;
    return (
      <svg
        className="a2ui-icon svg"
        viewBox="0 0 24 24"
        style={{
          ...baseStyle,
          fill: 'currentColor',
          width: 'var(--a2ui-icon-size, 24px)',
          height: 'var(--a2ui-icon-size, 24px)',
        }}
      >
        <path d={path}></path>
      </svg>
    );
  }

  const iconName = typeof props.name === 'string' ? toMaterialSymbol(props.name) : '';

  const fontStyle: React.CSSProperties = {
    ...baseStyle,
    fontFamily: 'var(--a2ui-icon-font-family, "Material Symbols Outlined", sans-serif)',
    fontVariationSettings: 'var(--a2ui-icon-font-variation-settings, "FILL" 1)',
    fontWeight: 'normal',
    fontStyle: 'normal',
    letterSpacing: 'normal',
    textTransform: 'none',
  };

  return (
    <span className="material-symbols-outlined" style={fontStyle}>
      {iconName}
    </span>
  );
});
