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
import {VideoApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Video component (v0.9).
 *
 * Renders a video player with standard controls.
 *
 * Supported CSS variables:
 * - `--a2ui-video-border-radius`: Controls the border radius of the video element.
 */
@Component({
  selector: 'a2ui-v09-video',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-video-container">
      <video [attr.src]="url() || null" controls class="a2ui-video">
        Your browser does not support the video tag.
      </video>
    </div>
  `,
  styles: [
    `
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoComponent extends BasicCatalogComponent<typeof VideoApi> {
  readonly url = computed(() => this.props()['url']?.value());
}
