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

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  type ComponentApi,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
} from '@a2ui/web_core/v1_0';

import {clampFloorplanPlacement, isFloorplanScene} from '../domain/geometry.js';
import type {FloorplanPlacement, TrayPiece} from '../domain/types.js';
import {CANVAS_THEME_VARS} from './styles.js';

export const PieceTrayApi = {
  name: 'PieceTray',
  schema: spec(
    z
      .object({
        pieces: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Candidate furniture or garden pieces with scale footprints.',
        ),
        placements: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Two-way bound placements array updated when toggling or swapping pieces.',
        ),
        scene: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional floorplan scene used to clamp swapped footprints inside walls.',
        ).optional(),
        selectedId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional two-way bound selected item ID.',
        ).optional(),
        title: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Optional section heading for the tray.',
        ).optional(),
      })
      .describe(
        'Tactile scale-preview token strip of candidate items that toggle or swap into placements.',
      )
      .strict(),
    {mixins: [], required: ['pieces', 'placements']},
  ),
} satisfies ComponentApi;

export function applyTrayPieceToggle(
  piece: TrayPiece,
  current: readonly FloorplanPlacement[],
  roomW = 168,
  roomH = 120,
  snapIn = 2,
): {next: FloorplanPlacement[]; focusId: string} {
  const existingExact = current.find(item => item.pieceId === piece.pieceId);
  if (existingExact) {
    if (piece.optional) {
      const filtered = current.filter(item => item.pieceId !== piece.pieceId);
      return {next: filtered, focusId: filtered[0]?.id ?? ''};
    }
    return {next: [...current], focusId: existingExact.id};
  }

  if (piece.slotGroup) {
    const slotMatch = current.find(item => item.slotGroup === piece.slotGroup);
    if (slotMatch) {
      const replacement = clampFloorplanPlacement(
        {
          id: slotMatch.id,
          pieceId: piece.pieceId,
          label: piece.label,
          shortLabel: piece.shortLabel,
          kind: piece.kind,
          x: slotMatch.x,
          y: slotMatch.y,
          w: piece.w,
          h: piece.h,
          rot: slotMatch.rot,
          clearanceIn: piece.clearanceIn,
          accent: piece.accent,
          slotGroup: piece.slotGroup,
          note: piece.note,
        },
        roomW,
        roomH,
        snapIn,
      );
      return {
        next: current.map(item => (item.id === slotMatch.id ? replacement : item)),
        focusId: replacement.id,
      };
    }
  }

  const added = clampFloorplanPlacement(
    {
      id: piece.placementId,
      pieceId: piece.pieceId,
      label: piece.label,
      shortLabel: piece.shortLabel,
      kind: piece.kind,
      x: piece.defaultX,
      y: piece.defaultY,
      w: piece.w,
      h: piece.h,
      rot: piece.defaultRot,
      clearanceIn: piece.clearanceIn,
      accent: piece.accent,
      ...(piece.slotGroup ? {slotGroup: piece.slotGroup} : {}),
      ...(piece.optional ? {optional: true} : {}),
      note: piece.note,
    },
    roomW,
    roomH,
    snapIn,
  );
  return {next: [...current, added], focusId: added.id};
}

/**
 * Tactile scale-preview token strip of candidate furniture/patio pieces.
 *
 * @cssprop [--a2ui-piece-tray-gap=6px] - Grid gap between piece tokens.
 */
export class A2uiPieceTrayElement extends A2uiLitElement<typeof PieceTrayApi> {
  static readonly tagName = 'a2ui-canvas-piece-tray';

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .pt-box {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .pt-heading {
        font-size: 11px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cs-muted);
      }
      .pt-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--a2ui-piece-tray-gap, 6px);
      }
      .pt-token {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 7px;
        border-radius: 8px;
        border: 1px solid var(--cs-border);
        background: var(--cs-bg);
        color: var(--cs-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .pt-token:hover {
        border-color: var(--cs-accent);
      }
      .pt-token[aria-pressed='true'] {
        background: color-mix(in srgb, var(--cs-accent) 13%, var(--cs-bg));
        border-color: var(--cs-accent);
      }
      .pt-thumb {
        width: 26px;
        height: 22px;
        flex-shrink: 0;
      }
      .pt-meta {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .pt-name {
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pt-sub {
        font-size: 10.5px;
        color: var(--cs-muted);
        line-height: 1.2;
      }
      .pt-star {
        color: var(--cs-accent);
      }
    `,
  ];

  protected override readonly api = PieceTrayApi;

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const pieces = Array.isArray(props['pieces']) ? (props['pieces'] as TrayPiece[]) : [];
    if (pieces.length === 0) return nothing;

    const placements = Array.isArray(props['placements'])
      ? (props['placements'] as FloorplanPlacement[])
      : [];
    const scene = props['scene'];
    const roomW = isFloorplanScene(scene) ? scene.roomW : 168;
    const roomH = isFloorplanScene(scene) ? scene.roomH : 120;
    const snapIn = isFloorplanScene(scene) ? scene.snapIn : 2;
    const heading =
      typeof props['title'] === 'string' && props['title'] ? props['title'] : 'Candidate pieces';

    const setPlacements = props['setPlacements'] as
      | ((val: FloorplanPlacement[]) => void)
      | undefined;
    const setSelectedId = props['setSelectedId'] as ((val: string) => void) | undefined;

    return html`
      <div class="pt-box" role="group" aria-label=${heading}>
        <div class="pt-heading">${heading}</div>
        <div class="pt-grid">
          ${pieces.map(piece => {
            const active = placements.some(item => item.pieceId === piece.pieceId);
            const thumbW = Math.max(8, Math.min(22, Math.round((piece.w / 72) * 22)));
            const thumbH = Math.max(7, Math.min(18, Math.round((piece.h / 64) * 18)));
            const thumbX = Math.round((26 - thumbW) / 2);
            const thumbY = Math.round((22 - thumbH) / 2);
            return html`
              <button
                type="button"
                class="pt-token"
                aria-pressed=${active ? 'true' : 'false'}
                @click=${() => {
                  const {next, focusId} = applyTrayPieceToggle(
                    piece,
                    placements,
                    roomW,
                    roomH,
                    snapIn,
                  );
                  setPlacements?.(next);
                  if (focusId) setSelectedId?.(focusId);
                }}
              >
                <svg class="pt-thumb" viewBox="0 0 26 22" aria-hidden="true">
                  ${svg`
                    <rect
                      x=${thumbX}
                      y=${thumbY}
                      width=${thumbW}
                      height=${thumbH}
                      rx="2.5"
                      fill=${active ? 'var(--cs-accent)' : 'var(--cs-surface-alt)'}
                      fill-opacity=${active ? '0.28' : '0.85'}
                      stroke=${active ? 'var(--cs-accent)' : 'var(--cs-muted)'}
                      stroke-width="1.3"
                    />
                  `}
                </svg>
                <span class="pt-meta">
                  <span class="pt-name">
                    ${piece.recommended
                      ? html`<span class="pt-star">★ </span>`
                      : nothing}${piece.label}
                  </span>
                  <span class="pt-sub">
                    ${piece.w}×${piece.h}" · ${active ? 'In room' : piece.badge}
                  </span>
                </span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }
}

export const A2uiPieceTray = {
  ...PieceTrayApi,
  tagName: A2uiPieceTrayElement.tagName,
  element: A2uiPieceTrayElement,
};
