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
import {repeat} from 'lit/directives/repeat.js';
import {styleMap} from 'lit/directives/style-map.js';
import {getAccessibilityDescription, getAccessibilityLabel} from './accessibility.js';
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';
import type {ListSupportedApis} from './supported_apis.js';
import type {ResolvedChildList} from '../../index.js';

const ALIGN_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

function getChildKey(child: any): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath ?? ''}/${child.id}`
    : String(child);
}

function itemKey(item: {child: unknown}): string {
  return getChildKey(item.child);
}

export class A2uiListElement extends BasicCatalogA2uiLitElement<ListSupportedApis> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-list';
  /** @nocollapse */
  static override styles = css`
    .a2ui-list {
      display: flex;
      padding-inline-start: var(--a2ui-list-padding, var(--a2ui-spacing-l, 24px));
      margin: 0;
    }
    .a2ui-list.a2ui-list-vertical {
      flex-direction: column;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-s, 8px));
    }
    .a2ui-list.a2ui-list-horizontal {
      flex-direction: row;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 16px));
      list-style-position: inside;
    }
    .a2ui-list-item-none {
      display: block;
    }
    .a2ui-list-horizontal .a2ui-list-item-none {
      display: inline-block;
    }
    /* A fallback host its adapter left empty renders nothing, so its item goes too. */
    li:has(> [data-a2ui-fallback-host]:empty),
    .a2ui-list-item-none:has(> [data-a2ui-fallback-host]:empty) {
      display: none;
    }
  `;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    // A child that renders nothing gets no item: an empty <li> would still show a marker and
    // take a gap. A child's fallback is content like any other and gets one.
    const items = children
      .map(child => ({child, content: this.renderNodeOrNull(child)}))
      .filter(item => item.content !== null);
    const listStyle = (props as any).listStyle;
    const direction = props.direction || 'vertical';
    const alignItems = props.align ? (ALIGN_MAP[props.align] ?? 'stretch') : undefined;
    const listInlineStyle = alignItems ? styleMap({alignItems}) : nothing;

    const a11yLabel = getAccessibilityLabel(props.accessibility);
    const a11yDescription = getAccessibilityDescription(props.accessibility);

    if (listStyle === 'ordered') {
      return html`
        <ol
          class="a2ui-list a2ui-list-${direction}"
          style=${listInlineStyle}
          aria-label=${a11yLabel}
          aria-description=${a11yDescription}
        >
          ${repeat(items, itemKey, item => html`<li>${item.content}</li>`)}
        </ol>
      `;
    }

    if (listStyle === 'unordered') {
      return html`
        <ul
          class="a2ui-list a2ui-list-${direction}"
          style=${listInlineStyle}
          aria-label=${a11yLabel}
          aria-description=${a11yDescription}
        >
          ${repeat(items, itemKey, item => html`<li>${item.content}</li>`)}
        </ul>
      `;
    }

    return html`
      <div
        class="a2ui-list a2ui-list-${direction}"
        style=${listInlineStyle}
        role="list"
        aria-label=${a11yLabel}
        aria-description=${a11yDescription}
      >
        ${repeat(
          items,
          itemKey,
          item => html`<div class="a2ui-list-item-none" role="listitem">${item.content}</div>`,
        )}
      </div>
    `;
  }
}
