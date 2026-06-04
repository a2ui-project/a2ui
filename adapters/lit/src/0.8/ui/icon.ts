/*
 * Copyright 2025 Google LLC
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

import {html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Root} from './root.js';
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';
import * as Primitives from '@a2ui/web_core/types/primitives';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';
import {structuralStyles} from './styles.js';

@customElement('a2ui-icon')
export class Icon extends Root {
  @property()
  accessor name: Primitives.StringValue | null = null;

  static styles = [
    structuralStyles,
    css`
      * {
        box-sizing: border-box;
      }

      :host {
        display: block;
        flex: var(--weight);
        min-height: 0;
      }

      .g-icon {
        font-family: 'Material Symbols Outlined';
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        display: inline-block;
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
      }
    `,
  ];

  #renderIcon() {
    if (!this.name) {
      return nothing;
    }

    const render = (url: string) => {
      url = url.replace(/([A-Z])/gm, '_$1').toLocaleLowerCase();
      return html`<span class="g-icon">${url}</span>`;
    };

    if (this.name && typeof this.name === 'object') {
      if ('literalString' in this.name) {
        const iconName = this.name.literalString ?? '';
        return render(iconName);
      } else if ('literal' in this.name) {
        const iconName = this.name.literal ?? '';
        return render(iconName);
      } else if (this.name && 'path' in this.name && this.name.path) {
        if (!this.processor || !this.component) {
          return html`(no model)`;
        }

        const iconName = this.processor.getData(
          this.component,
          this.name.path,
          this.surfaceId ?? A2uiMessageProcessor.DEFAULT_SURFACE_ID,
        );
        if (!iconName) {
          return html`Invalid icon name`;
        }

        if (typeof iconName !== 'string') {
          return html`Invalid icon name`;
        }
        return render(iconName);
      }
    }

    return html`(empty)`;
  }

  render() {
    return html`<section
      class=${classMap(this.theme.components.Icon)}
      style=${this.theme.additionalStyles?.Icon
        ? styleMap(this.theme.additionalStyles?.Icon)
        : nothing}
    >
      ${this.#renderIcon()}
    </section>`;
  }
}
