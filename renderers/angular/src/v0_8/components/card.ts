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

import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {DynamicComponent} from '../rendering/dynamic-component';
import {Renderer} from '../rendering/renderer';
import type {AnyComponentNode, CardNode} from '../types';

@Component({
  selector: 'a2ui-card',
  imports: [Renderer],
  template: `
    <div [class]="theme.components.Card" [style]="theme.additionalStyles?.Card">
      @if (child()) {
        <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="child()!" />
      }

      @for (comp of children(); track comp.id) {
        <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="comp" />
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Card extends DynamicComponent<CardNode> {
  readonly child = input<AnyComponentNode | null>(null);
  readonly children = input<AnyComponentNode[]>([]);
}
