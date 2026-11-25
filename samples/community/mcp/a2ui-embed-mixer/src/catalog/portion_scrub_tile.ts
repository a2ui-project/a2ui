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

/**
 * `PortionScrubTile`: Tactile visual tile with inline SVG icon, horizontal scrub/stepper scale
 * (`0.5x .. 2.0x`), and 1-click swap pills (`★ Greek yogurt` <-> `Eggs` <-> `Tofu`) writing
 * `/items` directly, plus optional `detailChild: ChildSchema`.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  ChildSchema,
  DynamicValueSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import type {MixItem, MixOption} from './functions.js';
import {renderMixerIcon} from './icons.js';

export const PortionScrubTileApi = {
  name: 'PortionScrubTile',
  schema: spec(
    z
      .object({
        itemId: z.string().describe('ID of the item in /items controlled by this tile.'),
        items: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Bound to /items so scrubbing or swapping updates the surface data model live.',
        ),
        minScale: z
          .number()
          .min(0.25)
          .max(1)
          .describe('Minimum scale multiplier. Defaults to 0.5.')
          .optional(),
        maxScale: z
          .number()
          .min(1)
          .max(3)
          .describe('Maximum scale multiplier. Defaults to 2.0.')
          .optional(),
        step: z
          .number()
          .min(0.05)
          .max(0.5)
          .describe('Scale step increment. Defaults to 0.25.')
          .optional(),
        detailChild: ChildSchema.describe(
          'REF:#/$defs/Child|Optional nested detail or constraint child component.',
        ).optional(),
      })
      .describe(
        'Tactile portion/allocation scrubber tile with 0.5x..2.0x scale slider, +/- steppers, and 1-click swap pills.',
      )
      .strict(),
    {mixins: [], required: ['itemId', 'items']},
  ),
} satisfies ComponentApi;

interface WritableItemsControllerProps {
  setItems?: (next: unknown) => void;
}

function findItem(rawItems: unknown, itemId: string): MixItem | undefined {
  if (!Array.isArray(rawItems)) return undefined;
  return rawItems.find(
    (entry): entry is MixItem =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>)['id'] === itemId,
  );
}

function activeOptionOf(item: MixItem): MixOption | undefined {
  if (!Array.isArray(item.options) || item.options.length === 0) return undefined;
  return item.options.find(opt => opt.id === item.activeOptionId) ?? item.options[0];
}

/**
 * @cssprop [--a2ui-scrub-tile-bg=var(--color-background-secondary)] - Tile card background.
 * @cssprop [--a2ui-scrub-tile-accent=var(--color-ring-primary)] - Active pill and slider accent.
 */
export class A2uiPortionScrubTileElement extends A2uiLitElement<typeof PortionScrubTileApi> {
  static readonly tagName = 'a2ui-portion-scrub-tile';

  static override styles = css`
    :host {
      display: block;
    }
    .scrub-tile {
      box-sizing: border-box;
      height: 100%;
      padding: 7px 9px;
      border-radius: 9px;
      background: var(
        --a2ui-scrub-tile-bg,
        var(--color-background-secondary, light-dark(#f6f8fc, #28292a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#dfe3e8, #3c4043));
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .scrub-tile__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .scrub-tile__title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }
    .scrub-tile__text {
      min-width: 0;
      flex: 1;
    }
    .scrub-tile__icon {
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--a2ui-scrub-tile-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
      border: 1px solid var(--color-border-primary, light-dark(#e0e4ea, #3c4043));
    }
    .scrub-tile__name {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .scrub-tile__note {
      font-size: 10.5px;
      line-height: 1.2;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .scrub-tile__scale-badge {
      flex: none;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 6px;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--a2ui-scrub-tile-accent, var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8)));
      border: 1px solid var(--color-border-primary, light-dark(#dadce0, #444746));
      font-variant-numeric: tabular-nums;
    }
    .scrub-tile__scrubber {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .scrub-tile__step-btn {
      flex: none;
      width: 22px;
      height: 20px;
      padding: 0;
      border-radius: 5px;
      border: 1px solid var(--color-border-primary, light-dark(#d2d7de, #444746));
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
    }
    .scrub-tile__step-btn:hover:not(:disabled) {
      border-color: var(
        --a2ui-scrub-tile-accent,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
    }
    .scrub-tile__step-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .scrub-tile__range {
      flex: 1;
      min-width: 0;
      height: 14px;
      margin: 0;
      cursor: pointer;
      accent-color: var(
        --a2ui-scrub-tile-accent,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
    }
    .scrub-tile__pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .scrub-tile__pill {
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.3;
      cursor: pointer;
      border: 1px solid var(--color-border-primary, light-dark(#d4d8de, #444746));
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--color-text-secondary, light-dark(#474b50, #b8bcc2));
      transition:
        background-color 140ms ease,
        color 140ms ease,
        border-color 140ms ease;
    }
    .scrub-tile__pill[data-active='true'] {
      background: var(
        --a2ui-scrub-tile-accent,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
      border-color: var(
        --a2ui-scrub-tile-accent,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
      color: light-dark(#ffffff, #101824);
    }
  `;

  protected override readonly api = PortionScrubTileApi;

  private updateItem(patch: Partial<Pick<MixItem, 'scale' | 'activeOptionId'>>): void {
    const props = this.controller?.props;
    if (!props) return;
    const rawItems = props['items'];
    const itemId = props['itemId'];
    if (!Array.isArray(rawItems) || typeof itemId !== 'string') return;

    const nextItems = rawItems.map(entry => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>)['id'] === itemId
      ) {
        return {...(entry as Record<string, unknown>), ...patch};
      }
      return entry;
    });
    (props as unknown as WritableItemsControllerProps).setItems?.(nextItems);
  }

  private clampScale(next: number, min: number, max: number, step: number): number {
    const snapped = Math.round(next / step) * step;
    const bounded = Math.min(max, Math.max(min, snapped));
    return Math.round(bounded * 100) / 100;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const itemId = typeof props['itemId'] === 'string' ? props['itemId'] : '';
    const item = findItem(props['items'], itemId);
    if (!item) return nothing;

    const minScale = typeof props['minScale'] === 'number' ? props['minScale'] : 0.5;
    const maxScale = typeof props['maxScale'] === 'number' ? props['maxScale'] : 2.0;
    const step = typeof props['step'] === 'number' ? props['step'] : 0.25;
    const currentScale = typeof item.scale === 'number' ? item.scale : 1.0;
    const activeOpt = activeOptionOf(item);
    const scaleText = `${currentScale.toFixed(currentScale % 0.5 === 0 ? 1 : 2)}x`;

    return html`
      <div class="scrub-tile" data-item-id=${item.id}>
        <div class="scrub-tile__head">
          <div class="scrub-tile__title-wrap">
            <span class="scrub-tile__icon">${renderMixerIcon(item.icon)}</span>
            <div class="scrub-tile__text">
              <div class="scrub-tile__name">${item.title}</div>
              <div class="scrub-tile__note">${activeOpt?.note ?? item.subtitle}</div>
            </div>
          </div>
          <span class="scrub-tile__scale-badge">${scaleText}</span>
        </div>

        <div class="scrub-tile__scrubber">
          <button
            type="button"
            class="scrub-tile__step-btn"
            aria-label=${`Decrease ${item.title}`}
            ?disabled=${currentScale <= minScale}
            @click=${() =>
              this.updateItem({
                scale: this.clampScale(currentScale - step, minScale, maxScale, step),
              })}
          >
            −
          </button>
          <input
            type="range"
            class="scrub-tile__range"
            aria-label=${`${item.title} scale`}
            min=${String(minScale)}
            max=${String(maxScale)}
            step=${String(step)}
            .value=${String(currentScale)}
            @input=${(event: Event) => {
              const raw = Number((event.target as HTMLInputElement).value);
              if (!Number.isNaN(raw)) {
                this.updateItem({scale: this.clampScale(raw, minScale, maxScale, step)});
              }
            }}
          />
          <button
            type="button"
            class="scrub-tile__step-btn"
            aria-label=${`Increase ${item.title}`}
            ?disabled=${currentScale >= maxScale}
            @click=${() =>
              this.updateItem({
                scale: this.clampScale(currentScale + step, minScale, maxScale, step),
              })}
          >
            +
          </button>
        </div>

        <div class="scrub-tile__pills" role="group" aria-label=${`${item.title} swaps`}>
          ${item.options.map(option => {
            const active = option.id === (activeOpt?.id ?? item.activeOptionId);
            const label = option.id === item.recommendedId ? `★ ${option.label}` : option.label;
            return html`
              <button
                type="button"
                class="scrub-tile__pill"
                data-option-id=${option.id}
                data-active=${active ? 'true' : 'false'}
                aria-pressed=${active ? 'true' : 'false'}
                @click=${() => this.updateItem({activeOptionId: option.id})}
              >
                ${label}
              </button>
            `;
          })}
        </div>

        ${props['detailChild']
          ? html`<div>${this.renderNode(props['detailChild'])}</div>`
          : nothing}
      </div>
    `;
  }
}

export const A2uiPortionScrubTile = {
  ...PortionScrubTileApi,
  tagName: A2uiPortionScrubTileElement.tagName,
  element: A2uiPortionScrubTileElement,
};
