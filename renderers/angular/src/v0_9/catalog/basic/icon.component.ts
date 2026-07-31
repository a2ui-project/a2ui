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

import {Component, computed, ChangeDetectionStrategy} from '@angular/core';
import {BasicCatalogComponent} from './basic-catalog-component';
import {IconApi} from '@a2ui/web_core/v0_9/basic_catalog';

const ICON_NAME_OVERRIDES: Record<string, string> = {
  play: 'play_arrow',
  rewind: 'fast_rewind',
  favoriteOff: 'favorite_border',
  starOff: 'star_border',
};

/**
 * Angular implementation of the A2UI Icon component (v0.9).
 *
 * Supports both Material Icons (by name) and custom SVG icons (by path).
 *
 * Supported CSS variables:
 * - `--a2ui-icon-size`: Controls the width, height, and font size of the icon.
 * - `--a2ui-icon-font-family`: Controls the font family for icon fonts.
 * - `--a2ui-icon-color`: Controls the color of the icon.
 * - `--a2ui-icon-font-variation-settings`: Controls font variation settings (e.g. FILL).
 */
@Component({
  selector: 'a2ui-v09-icon',
  standalone: true,
  imports: [],
  template: `
    @if (isSvgPath()) {
      <svg class="a2ui-icon svg" viewBox="0 0 24 24">
        <path [attr.d]="svgPath()"></path>
      </svg>
    } @else {
      <i class="material-icons a2ui-icon">
        {{ iconName() }}
      </i>
    }
  `,
  styles: [
    `
      .a2ui-icon {
        display: inline-block;
        width: var(--a2ui-icon-size, 24px);
        height: var(--a2ui-icon-size, 24px);
        font-size: var(--a2ui-icon-size, 24px);
        font-family: var(--a2ui-icon-font-family, 'Material Icons');
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent extends BasicCatalogComponent<typeof IconApi> {
  readonly iconNameRaw = computed(() => this.props()['name']?.value());

  readonly isSvgPath = computed(() => {
    const name = this.iconNameRaw();
    return typeof name === 'object' && name !== null && 'svgPath' in name;
  });

  readonly svgPath = computed(() => {
    const name = this.iconNameRaw();
    if (typeof name === 'object' && name !== null && 'svgPath' in name) {
      return name.svgPath;
    }
    return '';
  });

  readonly iconName = computed(() => {
    const name = this.iconNameRaw();
    if (typeof name !== 'string') return '';
    if (ICON_NAME_OVERRIDES[name]) return ICON_NAME_OVERRIDES[name];
    // Convert camelCase to snake_case for Material Icons
    return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  });
}
