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

import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {DynamicComponent} from '../rendering/dynamic-component';
import type {AudioPlayerNode, StringValue} from '../types';

@Component({
  selector: 'a2ui-audio',
  template: `
    <audio controls [src]="resolvedUrl()" [style]="theme.additionalStyles?.AudioPlayer"></audio>
  `,
  styles: `
    :host {
      display: flex;
    }
    audio {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioPlayer extends DynamicComponent<AudioPlayerNode> {
  readonly url = input.required<StringValue | null>();
  protected readonly resolvedUrl = computed(() => this.resolvePrimitive(this.url()));
}
