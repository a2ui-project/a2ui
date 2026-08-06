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

import {html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Root} from './root.js';
import {styleMap} from 'lit/directives/style-map.js';
import {classMap} from 'lit/directives/class-map.js';
import {structuralStyles} from './styles.js';

@customElement('a2ui-divider')
export class Divider extends Root {
  @property()
  accessor axis: 'horizontal' | 'vertical' | null = 'horizontal';

  @property()
  accessor color: string | null = null;

  @property({type: Number})
  accessor thickness: number | null = null;

  static styles = [
    structuralStyles,
    css`
      :host {
        display: block;
        min-height: 0;
        overflow: auto;
        align-self: stretch;
      }

      hr,
      .vertical-divider {
        background: #ccc;
        border: none;
      }

      hr {
        height: 1px;
      }

      .vertical-divider {
        width: 1px;
        height: 100%;
      }
    `,
  ];

  render() {
    const dividerTheme =
      typeof this.theme?.components?.Divider === 'string'
        ? {[this.theme.components.Divider]: true}
        : this.theme?.components?.Divider;

    const classes = {
      ...dividerTheme,
      vertical: this.axis === 'vertical',
      horizontal: this.axis !== 'vertical',
    };

    const dynamicStyle: Record<string, string> = {};
    if (this.color) {
      dynamicStyle['background-color'] = this.color;
    }
    if (this.thickness !== null && this.thickness !== undefined) {
      if (this.axis === 'vertical') {
        dynamicStyle['width'] = `${this.thickness}px`;
      } else {
        dynamicStyle['height'] = `${this.thickness}px`;
      }
    }

    const style = {
      ...this.theme?.additionalStyles?.Divider,
      ...dynamicStyle,
    };

    return this.axis === 'vertical'
      ? html`<div
          class=${classMap({...classes, 'vertical-divider': true})}
          style=${styleMap(style)}
        ></div>`
      : html`<hr class=${classMap(classes)} style=${styleMap(style)} />`;
  }
}
