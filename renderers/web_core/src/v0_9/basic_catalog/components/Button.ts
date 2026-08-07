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
import {classMap} from 'lit/directives/class-map.js';
import {ButtonApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-basic-button')
export class A2uiBasicButtonElement extends BasicCatalogA2uiLitElement<typeof ButtonApi> {
  static override styles = css`
    .a2ui-button {
      padding: var(
        --a2ui-button-padding,
        var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem)
      );
      border-radius: var(--a2ui-button-border-radius, var(--a2ui-spacing-s, 0.25rem));
      border: var(
        --a2ui-button-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      cursor: pointer;
      margin: var(--a2ui-button-margin, var(--a2ui-spacing-m, 0.5rem));
      background: var(--a2ui-button-background, var(--a2ui-color-surface, #fff));
      box-shadow: var(--a2ui-button-box-shadow, none);
      font-weight: var(--a2ui-button-font-weight, normal);
      --_a2ui-text-margin: 0;
      --_a2ui-text-color: var(--a2ui-color-on-secondary, #333);
      color: var(--_a2ui-text-color);
    }
    .a2ui-button.primary {
      background: var(--a2ui-color-primary, #17e);
      --_a2ui-text-color: var(--a2ui-color-on-primary, #fff);
      color: var(--_a2ui-text-color);
      border: none;
    }
    .a2ui-button.borderless {
      background: none;
      border: none;
      padding: 0;
      color: var(--a2ui-color-primary, #17e);
    }
    .a2ui-button:disabled {
      background-color: #e9ecef;
      color: #6c757d;
      border-color: #ced4da;
      cursor: not-allowed;
    }
  `;

  protected createController() {
    return new A2uiController(this, ButtonApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const isDisabled = props.isValid === false;
    const variant = props.variant ?? 'default';

    const classes = {
      'a2ui-button': true,
      [variant]: true,
    };

    return html`
      <button
        type=${variant === 'primary' ? 'submit' : 'button'}
        class=${classMap(classes)}
        @click=${() => {
          if (isDisabled) return;
          if (typeof props.action === 'function') {
            props.action();
          } else if (
            props.action &&
            typeof props.action === 'object' &&
            'event' in (props.action as any)
          ) {
            this.context.dispatchAction(props.action);
          }
        }}
        ?disabled=${isDisabled}
      >
        ${props.child ? html`${this.renderNode(props.child)}` : nothing}
      </button>
    `;
  }
}

export const A2uiButton: WebComponentImplementation = {
  ...ButtonApi,
  tagName: 'a2ui-basic-button',
};
