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
import {AudioPlayerApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI AudioPlayer component (v0.9).
 *
 * Renders an audio player with standard controls and an optional description.
 *
 * Supported CSS variables:
 * - `--a2ui-audioplayer-background`: Controls the background of the player. Defaults to `transparent`.
 * - `--a2ui-audioplayer-border-radius`: Controls the border radius. Defaults to `0`.
 * - `--a2ui-audioplayer-padding`: Controls the padding. Defaults to `0`.
 */
@Component({
  selector: 'a2ui-v09-audio-player',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-audio-player">
      @if (description()) {
        <div class="a2ui-audio-description">
          {{ description() }}
        </div>
      }
      <audio [attr.src]="url() || null" controls class="a2ui-audio">
        Your browser does not support the audio tag.
      </audio>
    </div>
  `,
  styles: [
    `
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
        color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
      }
      .a2ui-audio {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioPlayerComponent extends BasicCatalogComponent<typeof AudioPlayerApi> {
  readonly description = computed(() => this.props()['description']?.value());
  readonly url = computed(() => this.props()['url']?.value());
}
