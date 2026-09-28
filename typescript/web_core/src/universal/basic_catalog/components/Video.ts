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

import type {UniversalVideoProps} from '../types.js';

import {html, nothing, css} from 'lit';
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';

export const VIDEO_TAG_NAME = 'a2ui-video';

export class A2uiVideoElement extends BasicCatalogA2uiLitElement<UniversalVideoProps> {
  static readonly tagName = VIDEO_TAG_NAME;
  /**
   * The styles of the video can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-video-border-radius`: Controls the rounded corners of the video. Defaults to `0`.
   */
  static override styles = css`
    .a2ui-video-container {
      width: 100%;
      max-width: 100%;
    }
    .a2ui-video {
      width: 100%;
      height: auto;
      display: block;
      border-radius: var(--a2ui-video-border-radius, 0);
    }
  `;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <div class="a2ui-video-container">
        <video
          src=${props.url || nothing}
          poster=${(props as any).posterUrl || (props as any).poster || nothing}
          controls
          class="a2ui-video"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    `;
  }
}
