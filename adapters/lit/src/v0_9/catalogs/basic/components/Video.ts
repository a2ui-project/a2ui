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

import {html, nothing, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {VideoApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-video')
export class A2uiVideoElement extends BasicCatalogA2uiLitElement<typeof VideoApi> {
  /**
   * The styles of the video can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-video-border-radius`: Controls the rounded corners of the video. Defaults to `0`.
   */
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    video {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--a2ui-video-border-radius, 0);
    }
  `;

  protected createController() {
    return new A2uiController(this, VideoApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`<video src=${props.url} controls class="a2ui-video"></video>`;
  }
}

export const A2uiVideo = {
  ...VideoApi,
  tagName: 'a2ui-video',
};
