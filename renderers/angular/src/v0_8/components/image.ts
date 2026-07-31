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
import * as Primitives from '@a2ui/web_core/types/primitives';
import * as Styles from '@a2ui/web_core/styles/index';
import type {ImageNode, ResolvedImage} from '../types';
import {DynamicComponent} from '../rendering/dynamic-component';

@Component({
  selector: 'a2ui-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      min-height: 0;
      overflow: auto;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
  `,
  template: `
    @let resolvedUrl = this.resolvedUrl();
    @let resolvedAltText = this.resolvedAltText();

    @if (resolvedUrl) {
      <section [class]="classes()" [style]="theme.additionalStyles?.Image">
        <img [src]="resolvedUrl" [alt]="resolvedAltText" />
      </section>
    }
  `,
})
export class Image extends DynamicComponent<ImageNode> {
  readonly url = input<Primitives.StringValue | null>(null);
  readonly usageHint = input<ResolvedImage['usageHint'] | null>(null);
  readonly fit = input<ResolvedImage['fit'] | null>(null);
  readonly altText = input<Primitives.StringValue | null>(null);

  protected readonly resolvedUrl = computed(() => this.resolvePrimitive(this.url()));
  protected readonly resolvedAltText = computed(() => this.resolvePrimitive(this.altText()) || '');

  protected classes = computed(() => {
    const usageHint = this.usageHint();

    return Styles.merge(
      this.theme.components.Image.all,
      usageHint ? this.theme.components.Image[usageHint] : {},
    );
  });
}
