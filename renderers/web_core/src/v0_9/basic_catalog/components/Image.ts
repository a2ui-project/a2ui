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
import {styleMap} from 'lit/directives/style-map.js';
import {ImageApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-image')
export class A2uiImageElement extends BasicCatalogA2uiLitElement<typeof ImageApi> {
  static override styles = css`
    .a2ui-image {
      display: block;
      max-width: 100%;
      height: auto;
      border-radius: var(--a2ui-image-border-radius, var(--a2ui-border-radius, 8px));
    }
    .a2ui-image.icon {
      width: var(--a2ui-image-icon-size, 24px);
      height: var(--a2ui-image-icon-size, 24px);
    }
    .a2ui-image.avatar {
      width: var(--a2ui-image-avatar-size, 40px);
      height: var(--a2ui-image-avatar-size, 40px);
      border-radius: 50%;
    }
    .a2ui-image.smallFeature {
      max-width: var(--a2ui-image-small-feature-size, 100px);
    }
    .a2ui-image.largeFeature {
      max-height: var(--a2ui-image-large-feature-size, 400px);
    }
    .a2ui-image.header {
      height: var(--a2ui-image-header-size, 200px);
    }
  `;

  protected createController() {
    return new A2uiController(this, ImageApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const variant = props.variant || 'default';
    const fit = props.fit || 'cover';

    return html`<img
      src=${props.url}
      alt=${props.description || ''}
      style=${styleMap({objectFit: fit})}
      class="a2ui-image ${variant}"
    />`;
  }
}

export const A2uiImage: WebComponentImplementation = {
  ...ImageApi,
  tagName: 'a2ui-image',
};
