/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {html, nothing, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {IconApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {WebComponentImplementation} from '../../catalog/types.js';

const ICON_NAME_OVERRIDES: Record<string, string> = {
  play: 'play_arrow',
  rewind: 'fast_rewind',
  favoriteOff: 'favorite_border',
  starOff: 'star_border',
};

function toMaterialIconName(name: string): string {
  if (ICON_NAME_OVERRIDES[name]) return ICON_NAME_OVERRIDES[name];
  return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

@customElement('a2ui-icon')
export class A2uiIconElement extends BasicCatalogA2uiLitElement<typeof IconApi> {
  /**
   * The icon component can be customized with the following CSS variables:
   *
   * - `--a2ui-icon-size`: Dimensions of the icon.
   * - `--a2ui-icon-color`: Color tint applied to the icon.
   * - `--a2ui-icon-font-family`: Override the font family for icons. Defaults to 'Material Icons', 'Material Symbols Outlined'.
   * - `--a2ui-icon-font-variation-settings`: Complete override for font-variation-settings.
   */
  static override styles = css`
    .a2ui-icon {
      display: inline-block;
      width: var(--a2ui-icon-size, 24px);
      height: var(--a2ui-icon-size, 24px);
      font-size: var(--a2ui-icon-size, 24px);
      font-style: normal;
      font-weight: normal;
      font-family: var(--a2ui-icon-font-family, 'Material Icons', 'Material Symbols Outlined');
      color: var(
        --a2ui-icon-color,
        var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333))
      );
      font-variation-settings: var(--a2ui-icon-font-variation-settings, 'FILL' 1);
      line-height: 1;
      text-transform: none;
      letter-spacing: normal;
      word-wrap: normal;
      white-space: nowrap;
      direction: ltr;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: 'liga';
      vertical-align: middle;
    }
    .a2ui-icon.svg {
      fill: currentColor;
    }
  `;

  protected readonly api = IconApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const name = props.name;
    const isSvgPath = typeof name === 'object' && name !== null && 'svgPath' in name;

    if (isSvgPath) {
      const svgPath = (name as {svgPath: string}).svgPath;
      return html`
        <svg class="a2ui-icon svg" viewBox="0 0 24 24">
          <path d=${svgPath}></path>
        </svg>
      `;
    }

    const iconName = typeof name === 'string' ? toMaterialIconName(name) : '';
    return html`<i class="material-icons a2ui-icon">${iconName}</i>`;
  }
}

export const A2uiIcon: WebComponentImplementation = {
  ...IconApi,
  tagName: 'a2ui-icon',
};
