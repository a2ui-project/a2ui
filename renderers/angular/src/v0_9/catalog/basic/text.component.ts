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

import {Component, computed, ChangeDetectionStrategy, inject, signal, effect} from '@angular/core';
import {MarkdownRenderer} from '../../core/markdown';
import {BasicCatalogComponent} from './basic-catalog-component';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Text component (v0.9).
 *
 * Renders text with support for simple Markdown.
 *
 * Supported CSS variables:
 * - `--a2ui-text-color-text`: Controls the text color.
 * - `--a2ui-text-margin`: Controls the margin of text elements.
 * - `--a2ui-font-family-title`: Controls the font family for titles.
 * - `--a2ui-line-height-headings`: Controls the line height for headings.
 * - `--a2ui-line-height-body`: Controls the line height for body text.
 * - `--a2ui-text-caption-color`: Controls the color for caption text.
 * - `--a2ui-text-a-color`: Controls the color for links.
 * - `--a2ui-text-a-font-weight`: Controls the font weight for links.
 * - Font sizes: `--a2ui-font-size-2xl`, `--a2ui-font-size-xl`, `--a2ui-font-size-l`, `--a2ui-font-size-m`, `--a2ui-font-size-s`, `--a2ui-font-size-xs`.
 */
@Component({
  selector: 'a2ui-v09-text',
  standalone: true,
  template: `
    @if (isNonMarkdownVariant()) {
      <span [class]="'a2ui-text ' + variant()">
        <!-- Nesting block elements like h1 inside a span is not correct HTML5. We should refactor this-->
        @switch (variant()) {
          @case ('h1') {
            <h1>{{ text() }}</h1>
          }
          @case ('h2') {
            <h2>{{ text() }}</h2>
          }
          @case ('h3') {
            <h3>{{ text() }}</h3>
          }
          @case ('h4') {
            <h4>{{ text() }}</h4>
          }
          @case ('h5') {
            <h5>{{ text() }}</h5>
          }
          @case ('caption') {
            <em>{{ text() }}</em>
          }
        }
      </span>
    } @else {
      <span [class]="'a2ui-text ' + variant()" [innerHTML]="resolvedText()"></span>
    }
  `,
  // We use :host ::ng-deep because the template content is injected via innerHTML (Markdown).
  // Angular's default view encapsulation cannot target elements injected via innerHTML because they lack the scoping attributes generated at compile time.
  // ::ng-deep allows styles to reach into the injected HTML, while :host keeps them scoped to this component.
  styles: [
    `
      :host ::ng-deep .a2ui-text p,
      :host ::ng-deep .a2ui-text h1,
      :host ::ng-deep .a2ui-text h2,
      :host ::ng-deep .a2ui-text h3,
      :host ::ng-deep .a2ui-text h4,
      :host ::ng-deep .a2ui-text h5,
      :host ::ng-deep .a2ui-text h6,
      :host ::ng-deep .a2ui-text ol,
      :host ::ng-deep .a2ui-text ul,
      :host ::ng-deep .a2ui-text li,
      :host ::ng-deep .a2ui-text blockquote,
      :host ::ng-deep .a2ui-text pre {
        margin: var(--_a2ui-text-margin, 0);
      }
      :host ::ng-deep .a2ui-text {
        color: var(
          --_a2ui-text-color,
          var(--a2ui-text-color-text, var(--a2ui-color-on-background))
        );
      }
      :host ::ng-deep .a2ui-text h1,
      :host ::ng-deep .a2ui-text h2,
      :host ::ng-deep .a2ui-text h3,
      :host ::ng-deep .a2ui-text h4,
      :host ::ng-deep .a2ui-text h5,
      :host ::ng-deep .a2ui-text h6 {
        font-family: var(--a2ui-font-family-title, inherit);
        line-height: var(--a2ui-line-height-headings, 1.2);
      }
      :host ::ng-deep .a2ui-text h1 {
        font-size: var(--a2ui-font-size-2xl);
      }
      :host ::ng-deep .a2ui-text h2 {
        font-size: var(--a2ui-font-size-xl);
      }
      :host ::ng-deep .a2ui-text h3 {
        font-size: var(--a2ui-font-size-l);
      }
      :host ::ng-deep .a2ui-text p,
      :host ::ng-deep .a2ui-text h4 {
        font-size: var(--a2ui-font-size-m);
      }
      :host ::ng-deep .a2ui-text h5 {
        font-size: var(--a2ui-font-size-s);
      }
      :host ::ng-deep .a2ui-text p {
        line-height: var(--a2ui-line-height-body, 1.5);
      }
      :host ::ng-deep .a2ui-text.caption {
        font-size: var(--a2ui-font-size-xs);
        color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
      }
      :host ::ng-deep .a2ui-text a {
        color: var(--a2ui-text-a-color, inherit);
        font-weight: var(--a2ui-text-a-font-weight, inherit);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextComponent extends BasicCatalogComponent<typeof TextApi> {
  private markdownRenderer = inject(MarkdownRenderer);

  private static readonly NON_MARKDOWN_VARIANTS = new Set<string>([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'caption',
  ]);

  readonly variant = computed(() => this.props()['variant']?.value() || 'body');
  readonly text = computed(() => this.props()['text']?.value() || '');

  readonly isNonMarkdownVariant = computed(() => {
    return TextComponent.NON_MARKDOWN_VARIANTS.has(this.variant());
  });

  resolvedText = signal<string>('');
  private renderRequestId = 0;

  constructor() {
    super();
    effect(() => {
      if (this.isNonMarkdownVariant()) {
        return;
      }
      const text = this.text();
      const requestId = ++this.renderRequestId;
      this.markdownRenderer.render(text).then(rendered => {
        if (requestId === this.renderRequestId) {
          this.resolvedText.set(rendered);
        }
      });
    });
  }
}
