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
import {AudioPlayerApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {createComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-audioplayer')
export class A2uiAudioPlayerElement extends BasicCatalogA2uiLitElement<typeof AudioPlayerApi> {
  static override styles = css`
    .a2ui-audio-player {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      background: var(--a2ui-audioplayer-background, transparent);
      border-radius: var(--a2ui-audioplayer-border-radius, 0);
      padding: var(--a2ui-audioplayer-padding, 0);
      width: 100%;
    }
    .a2ui-audio-description {
      font-size: var(--a2ui-font-size-s, 0.875rem);
      color: var(
        --a2ui-audioplayer-description-color,
        var(--a2ui-text-caption-color, light-dark(#666, #aaa))
      );
    }
    .a2ui-audio {
      width: 100%;
    }
  `;

  protected readonly api = AudioPlayerApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <div class="a2ui-audio-player">
        ${props.description
          ? html`<div class="a2ui-audio-description">${props.description}</div>`
          : nothing}
        <audio src=${props.url || nothing} controls class="a2ui-audio">
          Your browser does not support the audio tag.
        </audio>
      </div>
    `;
  }
}

export const A2uiAudioPlayer = createComponentImplementation(
  AudioPlayerApi,
  A2uiAudioPlayerElement,
);
