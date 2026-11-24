/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** `StudioShell`: outer frame, header summary pills, body slot list, and optional footer slot. */

import {css, html, nothing} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  type A2uiChildRef,
  ChildListSchema,
  ChildSchema,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  type ResolvedChildList,
  spec,
} from '@a2ui/web_core/v1_0';

import {parseTripStats} from './model.js';

function childKey(child: A2uiChildRef): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath}/${child.id}`
    : String(child);
}

export const StudioShellApi = {
  name: 'StudioShell',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Primary studio title for the day or trip.',
        ),
        subtitle: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Concise constraint or time-window subtitle.',
        ).optional(),
        badge: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Status pill text such as Draft or Locked.',
        ).optional(),
        stats: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional live tripStats summary object.',
        ).optional(),
        children: ChildListSchema.describe(
          'REF:#/$defs/ChildList|Ordered body components rendered inside the studio.',
        ),
        footer: ChildSchema.describe(
          'REF:#/$defs/Child|Optional footer component rendered at the bottom of the studio.',
        ).optional(),
      })
      .describe('Top-level trip studio card container with header telemetry, body, and footer.')
      .strict(),
    {mixins: [], required: ['title', 'children']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-studioshell-bg=var(--a2ui-color-surface)] - Card background color.
 * @cssprop [--a2ui-studioshell-padding=12px 14px] - Internal card padding.
 */
export class A2uiStudioShellElement extends A2uiLitElement<typeof StudioShellApi> {
  static readonly tagName = 'a2ui-trip-shell';

  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
    }
    .ts-shell {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: var(--a2ui-studioshell-padding, 12px 14px);
      border-radius: var(--a2ui-border-radius, 12px);
      border: var(--a2ui-border-width, 1px) solid
        var(--color-border-primary, var(--a2ui-color-border, light-dark(#dadce0, #3c4043)));
      background: var(
        --a2ui-studioshell-bg,
        var(--color-background-primary, var(--a2ui-color-background, light-dark(#ffffff, #1e1f20)))
      );
      color: var(--color-text-primary, var(--a2ui-color-on-surface, light-dark(#1f1f1f, #e3e3e3)));
    }
    .ts-shell__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid
        var(--color-border-primary, var(--a2ui-color-border, light-dark(#eceff1, #343638)));
    }
    .ts-shell__headings {
      min-width: 0;
      flex: 1;
    }
    .ts-shell__title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ts-shell__title {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    .ts-shell__badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: light-dark(#e8f0fe, #243757);
      color: light-dark(#185abc, #aecbfa);
    }
    .ts-shell__badge--locked {
      background: light-dark(#e6f4ea, #1b3b28);
      color: light-dark(#137333, #81c995);
    }
    .ts-shell__subtitle {
      margin: 2px 0 0;
      font-size: 12px;
      line-height: 1.35;
      color: var(
        --color-text-secondary,
        var(--a2ui-text-caption-color, light-dark(#5f6368, #a8abb0))
      );
    }
    .ts-shell__pills {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .ts-shell__pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      background: var(
        --color-background-secondary,
        var(--a2ui-color-surface, light-dark(#f1f3f4, #2b2d30))
      );
      color: var(--color-text-primary, light-dark(#3c4043, #e3e3e3));
      border: 1px solid var(--color-border-primary, light-dark(#e0e3e7, #3c4043));
    }
    .ts-shell__pill--warn {
      background: light-dark(#fef7e0, #3e2e14);
      color: light-dark(#b06000, #fdd663);
      border-color: light-dark(#fbbc04, #7a5917);
    }
    .ts-shell__pill--ok {
      background: light-dark(#e6f4ea, #1b3826);
      color: light-dark(#137333, #81c995);
      border-color: light-dark(#ceead6, #2d5a3f);
    }
    .ts-shell__body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ts-shell__footer {
      padding-top: 6px;
      border-top: 1px solid
        var(--color-border-primary, var(--a2ui-color-border, light-dark(#eceff1, #343638)));
    }
  `;

  protected override readonly api = StudioShellApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const title = typeof props['title'] === 'string' ? props['title'] : 'Trip Studio';
    const subtitle = typeof props['subtitle'] === 'string' ? props['subtitle'] : '';
    const badge = typeof props['badge'] === 'string' ? props['badge'] : '';
    const isLocked = badge.toLowerCase().includes('locked') || badge.includes('✓');
    const stats = parseTripStats(props['stats']);
    const rawChildren = props['children'];
    const children: ResolvedChildList = Array.isArray(rawChildren)
      ? rawChildren.filter(child => this.isChildResolved(child))
      : [];
    const footer = props['footer'];
    const showFooter = footer !== undefined && this.isChildResolved(footer);

    return html`
      <section class="ts-shell" role="region" aria-label=${title}>
        <header class="ts-shell__header">
          <div class="ts-shell__headings">
            <div class="ts-shell__title-row">
              <h1 class="ts-shell__title">${title}</h1>
              ${badge
                ? html`<span class="ts-shell__badge ${isLocked ? 'ts-shell__badge--locked' : ''}"
                    >${badge}</span
                  >`
                : nothing}
            </div>
            ${subtitle ? html`<p class="ts-shell__subtitle">${subtitle}</p>` : nothing}
          </div>
          ${stats
            ? html`
                <div class="ts-shell__pills" aria-label="Live itinerary telemetry">
                  <span class="ts-shell__pill">${stats.totalWalkMin}m walk</span>
                  <span class="ts-shell__pill">$${stats.totalCost}</span>
                  <span
                    class="ts-shell__pill ${stats.conflictCount > 0
                      ? 'ts-shell__pill--warn'
                      : 'ts-shell__pill--ok'}"
                  >
                    ${stats.conflictCount > 0
                      ? `${stats.conflictCount} ${stats.conflictCount === 1 ? 'conflict' : 'conflicts'}`
                      : 'Schedule clear'}
                  </span>
                </div>
              `
            : nothing}
        </header>
        <div class="ts-shell__body">
          ${repeat(children, childKey, child => html`${this.renderNode(child)}`)}
        </div>
        ${showFooter
          ? html`<div class="ts-shell__footer">${this.renderNode(footer)}</div>`
          : nothing}
      </section>
    `;
  }
}

export const A2uiStudioShell = {
  ...StudioShellApi,
  tagName: A2uiStudioShellElement.tagName,
  element: A2uiStudioShellElement,
};
