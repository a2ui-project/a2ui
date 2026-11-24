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
 * Interactive 2D SVG direct-manipulation stage (`PlanCanvas`) supporting two
 * geometric modes driven by `scene.mode`:
 * 1. `floorplan`: scaled room walls, door-swing arc, window daylight cone,
 *    point features, clearance halos, pointer drag, and nudge/rotate controls.
 * 2. `seating`: banquet tables with guest seat tokens, click-two-seats-to-swap,
 *    pointer drag-and-drop between seats, table rotation, and curved SVG
 *    social affinity/conflict arcs.
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

import {
  clampFloorplanPlacement,
  doorGeometry,
  footprintBox,
  formatRoomFeet,
  isFloorplanScene,
  isSeatingScene,
  rotateFloorplanPlacement,
  seatPosition,
} from '../domain/geometry.js';
import {swapGuestSeats} from '../domain/scenarios.js';
import type {
  FloorplanPlacement,
  FloorplanScene,
  PieceAccent,
  PlanEvaluation,
  SeatPlacement,
  SeatingScene,
} from '../domain/types.js';
import {CANVAS_THEME_VARS} from './styles.js';

export const PlanCanvasApi = {
  name: 'PlanCanvas',
  schema: spec(
    z
      .object({
        scene: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Floorplan or seating scene geometry.',
        ),
        placements: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Two-way bound placements array updated live on drag, nudge, rotate, or seat swap.',
        ),
        selectedId: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Two-way bound ID of the selected piece or guest.',
        ),
        evaluation: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional live evaluation from evaluatePlan for conflict halos and social arcs.',
        ).optional(),
      })
      .describe('Interactive 2D SVG floorplan and seating canvas with direct pointer manipulation.')
      .strict(),
    {mixins: [], required: ['scene', 'placements', 'selectedId']},
  ),
} satisfies ComponentApi;

const FP_PAD = 16;
const FP_SCALE = 2;

interface FloorDragState {
  readonly id: string;
  readonly pointerId: number;
  readonly startRoomX: number;
  readonly startRoomY: number;
  readonly origX: number;
  readonly origY: number;
}

interface SeatDragState {
  readonly guestId: string;
  readonly pointerId: number;
  readonly startSvgX: number;
  readonly startSvgY: number;
  curSvgX: number;
  curSvgY: number;
  hoverGuestId: string;
  moved: boolean;
}

function accentPalette(accent: PieceAccent): {fill: string; stroke: string} {
  switch (accent) {
    case 'indigo':
      return {
        fill: 'light-dark(#e8f0fe, #21324f)',
        stroke: 'light-dark(#3867c9, #8ab4f8)',
      };
    case 'teal':
      return {
        fill: 'light-dark(#e2f6f4, #173b3a)',
        stroke: 'light-dark(#0f827c, #59d3c8)',
      };
    case 'amber':
      return {
        fill: 'light-dark(#fef3dc, #3c2e16)',
        stroke: 'light-dark(#c07512, #f5b851)',
      };
    case 'sage':
      return {
        fill: 'light-dark(#e6f4ea, #1a3723)',
        stroke: 'light-dark(#2a7d3b, #78d089)',
      };
    case 'rose':
      return {
        fill: 'light-dark(#fdeaf0, #421d2b)',
        stroke: 'light-dark(#c23966, #f48fb1)',
      };
    case 'slate':
    default:
      return {
        fill: 'light-dark(#edf1f6, #2b3037)',
        stroke: 'light-dark(#5c6877, #9aa5b4)',
      };
  }
}

function svgCoordinates(
  svgEl: SVGSVGElement,
  clientX: number,
  clientY: number,
  vbW: number,
  vbH: number,
): {x: number; y: number} {
  if (typeof svgEl.createSVGPoint === 'function' && typeof svgEl.getScreenCTM === 'function') {
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const mapped = pt.matrixTransform(ctm.inverse());
      return {x: mapped.x, y: mapped.y};
    }
  }
  const rect = svgEl.getBoundingClientRect();
  const w = rect.width || vbW;
  const h = rect.height || vbH;
  return {
    x: ((clientX - rect.left) / w) * vbW,
    y: ((clientY - rect.top) / h) * vbH,
  };
}

/**
 * Interactive 2D SVG direct-manipulation floorplan & seating canvas.
 *
 * @cssprop [--a2ui-plan-canvas-max-height=238px] - Maximum height of the SVG viewport.
 */
export class A2uiPlanCanvasElement extends A2uiLitElement<typeof PlanCanvasApi> {
  static readonly tagName = 'a2ui-canvas-plan-canvas';

  static override properties = {
    armedSwapId: {state: true},
    seatDragTick: {state: true},
  };

  static override styles = [
    CANVAS_THEME_VARS,
    css`
      :host {
        display: block;
      }
      .pc-shell {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border-radius: 10px;
        border: 1px solid var(--cs-border);
        background: var(--cs-surface);
      }
      .pc-hud {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-height: 24px;
      }
      .pc-caption {
        font-size: 11.5px;
        color: var(--cs-muted);
        font-weight: 500;
      }
      .pc-caption strong {
        color: var(--cs-text);
        font-weight: 650;
      }
      .pc-controls {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .pc-ctrl {
        padding: 2px 7px;
        border-radius: 6px;
        border: 1px solid var(--cs-border);
        background: var(--cs-bg);
        color: var(--cs-text);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
        cursor: pointer;
      }
      .pc-ctrl:hover {
        border-color: var(--cs-accent);
      }
      .pc-svg {
        display: block;
        width: 100%;
        max-height: var(--a2ui-plan-canvas-max-height, 238px);
        height: auto;
        border-radius: 8px;
        background: var(--cs-bg);
        border: 1px solid var(--cs-border);
        touch-action: none;
        user-select: none;
      }
      .pc-piece,
      .pc-seat {
        cursor: grab;
        outline: none;
      }
      .pc-piece:active,
      .pc-seat:active {
        cursor: grabbing;
      }
    `,
  ];

  protected override readonly api = PlanCanvasApi;

  declare armedSwapId: string;
  declare seatDragTick: number;
  private floorDrag?: FloorDragState;
  private seatDrag?: SeatDragState;

  constructor() {
    super();
    this.armedSwapId = '';
    this.seatDragTick = 0;
  }

  override render() {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return nothing;
    const scene = props['scene'];
    const evaluation =
      typeof props['evaluation'] === 'object' &&
      props['evaluation'] !== null &&
      !Array.isArray(props['evaluation'])
        ? (props['evaluation'] as unknown as PlanEvaluation)
        : undefined;

    if (isFloorplanScene(scene)) {
      return this.renderFloorplan(scene, props, evaluation);
    }
    if (isSeatingScene(scene)) {
      return this.renderSeating(scene, props, evaluation);
    }
    return nothing;
  }

  private nudgeSelected(
    scene: FloorplanScene,
    placements: readonly FloorplanPlacement[],
    selectedId: string,
    dxIn: number,
    dyIn: number,
    setPlacements?: (next: FloorplanPlacement[]) => void,
  ): void {
    if (!setPlacements || placements.length === 0) return;
    const targetId = selectedId || placements[0]!.id;
    const next = placements.map(item =>
      item.id === targetId
        ? clampFloorplanPlacement(
            {...item, x: item.x + dxIn, y: item.y + dyIn},
            scene.roomW,
            scene.roomH,
            scene.snapIn,
          )
        : item,
    );
    setPlacements(next);
  }

  private rotateSelected(
    scene: FloorplanScene,
    placements: readonly FloorplanPlacement[],
    selectedId: string,
    setPlacements?: (next: FloorplanPlacement[]) => void,
  ): void {
    if (!setPlacements || placements.length === 0) return;
    const targetId = selectedId || placements[0]!.id;
    const next = placements.map(item =>
      item.id === targetId
        ? rotateFloorplanPlacement(item, scene.roomW, scene.roomH, scene.snapIn)
        : item,
    );
    setPlacements(next);
  }

  private renderFloorplan(
    scene: FloorplanScene,
    props: Record<string, unknown>,
    evaluation?: PlanEvaluation,
  ) {
    const placements = Array.isArray(props['placements'])
      ? (props['placements'] as FloorplanPlacement[])
      : [];
    const selectedId =
      typeof props['selectedId'] === 'string' && props['selectedId']
        ? props['selectedId']
        : (placements[0]?.id ?? '');
    const setPlacements = props['setPlacements'] as
      | ((val: FloorplanPlacement[]) => void)
      | undefined;
    const setSelectedId = props['setSelectedId'] as ((val: string) => void) | undefined;

    const violating = new Set(evaluation?.violatingIds ?? []);
    const doorRuleFailed = evaluation?.results.some(
      r => r.id.includes('door') && r.status !== 'pass',
    );

    const vbW = scene.roomW * FP_SCALE + FP_PAD * 2;
    const vbH = scene.roomH * FP_SCALE + FP_PAD * 2;
    const rx = (inX: number) => FP_PAD + inX * FP_SCALE;
    const ry = (inY: number) => FP_PAD + inY * FP_SCALE;

    const selectedItem = placements.find(p => p.id === selectedId) ?? placements[0];
    const door = doorGeometry(scene.door, scene.roomW, scene.roomH);

    const gridLinesX: number[] = [];
    for (let x = 24; x < scene.roomW; x += 24) gridLinesX.push(x);
    const gridLinesY: number[] = [];
    for (let y = 24; y < scene.roomH; y += 24) gridLinesY.push(y);

    const daylightPolygon = this.buildDaylightConePoints(scene, rx, ry);

    return html`
      <div class="pc-shell">
        <div class="pc-hud">
          <span class="pc-caption">
            ${formatRoomFeet(scene.roomW)} × ${formatRoomFeet(scene.roomH)}
            ${selectedItem
              ? html` · Selected: <strong>${selectedItem.shortLabel}</strong> (${Math.round(
                    selectedItem.x,
                  )}",
                  ${Math.round(selectedItem.y)}")`
              : nothing}
          </span>
          <div class="pc-controls" role="group" aria-label="Position and rotation controls">
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Nudge left"
              @click=${() =>
                this.nudgeSelected(scene, placements, selectedId, -8, 0, setPlacements)}
            >
              ←
            </button>
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Nudge up"
              @click=${() =>
                this.nudgeSelected(scene, placements, selectedId, 0, -8, setPlacements)}
            >
              ↑
            </button>
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Nudge down"
              @click=${() => this.nudgeSelected(scene, placements, selectedId, 0, 8, setPlacements)}
            >
              ↓
            </button>
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Nudge right"
              @click=${() => this.nudgeSelected(scene, placements, selectedId, 8, 0, setPlacements)}
            >
              →
            </button>
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Rotate 90 degrees"
              @click=${() => this.rotateSelected(scene, placements, selectedId, setPlacements)}
            >
              ↻ 90°
            </button>
          </div>
        </div>

        <svg
          class="pc-svg"
          viewBox="0 0 ${vbW} ${vbH}"
          role="application"
          aria-label="${scene.title} interactive floorplan"
          @pointermove=${(e: PointerEvent) => {
            if (!this.floorDrag || !setPlacements) return;
            const svgEl = e.currentTarget as SVGSVGElement;
            const pt = svgCoordinates(svgEl, e.clientX, e.clientY, vbW, vbH);
            const roomX = (pt.x - FP_PAD) / FP_SCALE;
            const roomY = (pt.y - FP_PAD) / FP_SCALE;
            const current = placements.find(p => p.id === this.floorDrag!.id);
            if (!current) return;
            const clamped = clampFloorplanPlacement(
              {
                ...current,
                x: this.floorDrag.origX + (roomX - this.floorDrag.startRoomX),
                y: this.floorDrag.origY + (roomY - this.floorDrag.startRoomY),
              },
              scene.roomW,
              scene.roomH,
              scene.snapIn,
            );
            if (clamped.x !== current.x || clamped.y !== current.y) {
              setPlacements(placements.map(p => (p.id === current.id ? clamped : p)));
            }
          }}
          @pointerup=${(e: PointerEvent) => {
            if (!this.floorDrag) return;
            const svgEl = e.currentTarget as SVGSVGElement;
            try {
              svgEl.releasePointerCapture(e.pointerId);
            } catch {
              // Synthetic test events may not hold an active pointer capture.
            }
            this.floorDrag = undefined;
          }}
          @pointercancel=${() => {
            this.floorDrag = undefined;
          }}
        >
          ${svg`
            <defs>
              <linearGradient id="pcDaylight-${this.domId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fbbc04" stop-opacity="0.26" />
                <stop offset="100%" stop-color="#fbbc04" stop-opacity="0.02" />
              </linearGradient>
            </defs>

            <!-- Room floor & 2-ft architectural grid -->
            <rect
              x=${rx(0)}
              y=${ry(0)}
              width=${scene.roomW * FP_SCALE}
              height=${scene.roomH * FP_SCALE}
              fill="var(--cs-surface)"
              fill-opacity="0.45"
            />
            ${gridLinesX.map(
              gx => svg`
                <line
                  x1=${rx(gx)}
                  y1=${ry(0)}
                  x2=${rx(gx)}
                  y2=${ry(scene.roomH)}
                  stroke="var(--cs-border)"
                  stroke-width="0.6"
                  stroke-dasharray="2 3"
                />
              `,
            )}
            ${gridLinesY.map(
              gy => svg`
                <line
                  x1=${rx(0)}
                  y1=${ry(gy)}
                  x2=${rx(scene.roomW)}
                  y2=${ry(gy)}
                  stroke="var(--cs-border)"
                  stroke-width="0.6"
                  stroke-dasharray="2 3"
                />
              `,
            )}

            <!-- Window / sun cone -->
            <polygon
              points=${daylightPolygon}
              fill="url(#pcDaylight-${this.domId})"
            />

            <!-- Point features (outlet / pergola shade) -->
            ${(scene.features ?? []).map(
              feat => svg`
                <g>
                  <circle
                    cx=${rx(feat.x)}
                    cy=${ry(feat.y)}
                    r=${Math.max(7, feat.r * FP_SCALE)}
                    fill=${feat.kind === 'shade' ? 'var(--cs-pass-bg)' : 'var(--cs-surface-alt)'}
                    fill-opacity="0.55"
                    stroke="var(--cs-muted)"
                    stroke-width="1"
                    stroke-dasharray="3 2"
                  />
                  <text
                    x=${rx(feat.x) + 8}
                    y=${ry(feat.y) + 3}
                    font-size="8.5"
                    fill="var(--cs-muted)"
                  >
                    ${feat.label}
                  </text>
                </g>
              `,
            )}

            <!-- Room perimeter walls -->
            <rect
              x=${rx(0)}
              y=${ry(0)}
              width=${scene.roomW * FP_SCALE}
              height=${scene.roomH * FP_SCALE}
              fill="none"
              stroke="var(--cs-text)"
              stroke-opacity="0.72"
              stroke-width="3"
            />

            <!-- Window sash highlight -->
            ${this.renderWindowSash(scene, rx, ry)}

            <!-- Door opening + quarter-circle swing arc -->
            <line
              x1=${rx(door.hx)}
              y1=${ry(door.hy)}
              x2=${rx(door.openX)}
              y2=${ry(door.openY)}
              stroke="var(--cs-bg)"
              stroke-width="5"
            />
            <path
              d="M ${rx(door.hx)} ${ry(door.hy)} L ${rx(door.tipX)} ${ry(door.tipY)} A ${scene.door.swingIn * FP_SCALE} ${scene.door.swingIn * FP_SCALE} 0 0 ${door.sweepFlag} ${rx(door.openX)} ${ry(door.openY)} Z"
              fill=${doorRuleFailed ? 'var(--cs-fail-bg)' : 'var(--cs-surface-alt)'}
              fill-opacity=${doorRuleFailed ? '0.68' : '0.45'}
              stroke=${doorRuleFailed ? 'var(--cs-fail-fg)' : 'var(--cs-muted)'}
              stroke-width="1.3"
              stroke-dasharray="4 3"
            />
            <line
              x1=${rx(door.hx)}
              y1=${ry(door.hy)}
              x2=${rx(door.tipX)}
              y2=${ry(door.tipY)}
              stroke=${doorRuleFailed ? 'var(--cs-fail-fg)' : 'var(--cs-text)'}
              stroke-width="2"
            />

            <!-- Furniture footprints + clearance halos -->
            ${placements.map(item => {
              const box = footprintBox(item);
              const isSelected = item.id === selectedId;
              const isBad = violating.has(item.id);
              const palette = accentPalette(item.accent);
              const haloIn = Math.min(18, Math.max(8, Math.round(item.clearanceIn / 2)));
              const px = rx(box.x1);
              const py = ry(box.y1);
              const pw = box.w * FP_SCALE;
              const ph = box.h * FP_SCALE;
              return svg`
                <g
                  class="pc-piece"
                  data-piece-id=${item.id}
                  role="button"
                  tabindex="0"
                  aria-label="${item.label} at ${Math.round(item.x)} by ${Math.round(item.y)} inches"
                  @pointerdown=${(e: PointerEvent) => {
                    e.stopPropagation();
                    setSelectedId?.(item.id);
                    const svgEl = (e.currentTarget as SVGGElement).ownerSVGElement;
                    if (!svgEl) return;
                    const pt = svgCoordinates(svgEl, e.clientX, e.clientY, vbW, vbH);
                    this.floorDrag = {
                      id: item.id,
                      pointerId: e.pointerId,
                      startRoomX: (pt.x - FP_PAD) / FP_SCALE,
                      startRoomY: (pt.y - FP_PAD) / FP_SCALE,
                      origX: item.x,
                      origY: item.y,
                    };
                    try {
                      svgEl.setPointerCapture(e.pointerId);
                    } catch {
                      // Synthetic pointer events in headless tests may omit active pointer state.
                    }
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      this.nudgeSelected(scene, placements, item.id, -8, 0, setPlacements);
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      this.nudgeSelected(scene, placements, item.id, 8, 0, setPlacements);
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      this.nudgeSelected(scene, placements, item.id, 0, -8, setPlacements);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      this.nudgeSelected(scene, placements, item.id, 0, 8, setPlacements);
                    } else if (e.key === 'r' || e.key === 'R') {
                      e.preventDefault();
                      this.rotateSelected(scene, placements, item.id, setPlacements);
                    }
                  }}
                >
                  ${
                    isSelected || isBad
                      ? svg`
                        <rect
                          x=${px - haloIn}
                          y=${py - haloIn}
                          width=${pw + haloIn * 2}
                          height=${ph + haloIn * 2}
                          rx="6"
                          fill="none"
                          stroke=${isBad ? 'var(--cs-fail-fg)' : 'var(--cs-accent)'}
                          stroke-width="1.2"
                          stroke-dasharray="3 3"
                          opacity="0.85"
                        />
                      `
                      : nothing
                  }
                  <rect
                    x=${px}
                    y=${py}
                    width=${pw}
                    height=${ph}
                    rx="4"
                    fill=${palette.fill}
                    stroke=${
                      isBad ? 'var(--cs-fail-fg)' : isSelected ? 'var(--cs-accent)' : palette.stroke
                    }
                    stroke-width=${isSelected || isBad ? '2.2' : '1.4'}
                  />
                  ${this.renderPieceDetail(item, px, py, pw, ph, palette.stroke)}
                  <text
                    x=${px + pw / 2}
                    y=${py + ph / 2 - (ph >= 34 ? 2 : -3)}
                    text-anchor="middle"
                    font-size=${pw < 48 ? '7.5' : '9.5'}
                    font-weight="650"
                    fill="var(--cs-text)"
                    pointer-events="none"
                  >
                    ${item.shortLabel}
                  </text>
                  ${
                    ph >= 34
                      ? svg`
                        <text
                          x=${px + pw / 2}
                          y=${py + ph / 2 + 10}
                          text-anchor="middle"
                          font-size="8"
                          fill="var(--cs-muted)"
                          pointer-events="none"
                        >
                          ${Math.round(box.w)}×${Math.round(box.h)}"
                        </text>
                      `
                      : nothing
                  }
                </g>
              `;
            })}
          `}
        </svg>
      </div>
    `;
  }

  private buildDaylightConePoints(
    scene: FloorplanScene,
    rx: (v: number) => number,
    ry: (v: number) => number,
  ): string {
    const w = scene.windowZone;
    const spread = 18;
    if (w.wall === 'left') {
      return `${rx(0)},${ry(w.offsetIn)} ${rx(w.reachIn)},${ry(Math.max(0, w.offsetIn - spread))} ${rx(w.reachIn)},${ry(Math.min(scene.roomH, w.offsetIn + w.widthIn + spread))} ${rx(0)},${ry(w.offsetIn + w.widthIn)}`;
    }
    if (w.wall === 'top') {
      return `${rx(w.offsetIn)},${ry(0)} ${rx(w.offsetIn + w.widthIn)},${ry(0)} ${rx(Math.min(scene.roomW, w.offsetIn + w.widthIn + spread))},${ry(w.reachIn)} ${rx(Math.max(0, w.offsetIn - spread))},${ry(w.reachIn)}`;
    }
    if (w.wall === 'bottom') {
      return `${rx(w.offsetIn)},${ry(scene.roomH)} ${rx(w.offsetIn + w.widthIn)},${ry(scene.roomH)} ${rx(Math.min(scene.roomW, w.offsetIn + w.widthIn + spread))},${ry(scene.roomH - w.reachIn)} ${rx(Math.max(0, w.offsetIn - spread))},${ry(scene.roomH - w.reachIn)}`;
    }
    return `${rx(scene.roomW)},${ry(w.offsetIn)} ${rx(scene.roomW - w.reachIn)},${ry(Math.max(0, w.offsetIn - spread))} ${rx(scene.roomW - w.reachIn)},${ry(Math.min(scene.roomH, w.offsetIn + w.widthIn + spread))} ${rx(scene.roomW)},${ry(w.offsetIn + w.widthIn)}`;
  }

  private renderWindowSash(
    scene: FloorplanScene,
    rx: (v: number) => number,
    ry: (v: number) => number,
  ) {
    const w = scene.windowZone;
    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;
    if (w.wall === 'left') {
      x1 = rx(0);
      y1 = ry(w.offsetIn);
      x2 = rx(0);
      y2 = ry(w.offsetIn + w.widthIn);
    } else if (w.wall === 'top') {
      x1 = rx(w.offsetIn);
      y1 = ry(0);
      x2 = rx(w.offsetIn + w.widthIn);
      y2 = ry(0);
    } else if (w.wall === 'bottom') {
      x1 = rx(w.offsetIn);
      y1 = ry(scene.roomH);
      x2 = rx(w.offsetIn + w.widthIn);
      y2 = ry(scene.roomH);
    } else {
      x1 = rx(scene.roomW);
      y1 = ry(w.offsetIn);
      x2 = rx(scene.roomW);
      y2 = ry(w.offsetIn + w.widthIn);
    }
    return svg`
      <line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke="#fbbc04" stroke-width="4.5" stroke-linecap="round" />
    `;
  }

  private renderPieceDetail(
    item: FloorplanPlacement,
    px: number,
    py: number,
    pw: number,
    ph: number,
    stroke: string,
  ) {
    if (item.kind === 'bed') {
      const vertical = Math.abs(item.rot % 180) === 0;
      return vertical
        ? svg`
            <rect x=${px + 8} y=${py + 6} width=${pw / 2 - 11} height="16" rx="3" fill="var(--cs-bg)" stroke=${stroke} stroke-width="1" opacity="0.85" />
            <rect x=${px + pw / 2 + 3} y=${py + 6} width=${pw / 2 - 11} height="16" rx="3" fill="var(--cs-bg)" stroke=${stroke} stroke-width="1" opacity="0.85" />
          `
        : svg`
            <rect x=${px + 6} y=${py + 8} width="16" height=${ph / 2 - 11} rx="3" fill="var(--cs-bg)" stroke=${stroke} stroke-width="1" opacity="0.85" />
            <rect x=${px + 6} y=${py + ph / 2 + 3} width="16" height=${ph / 2 - 11} rx="3" fill="var(--cs-bg)" stroke=${stroke} stroke-width="1" opacity="0.85" />
          `;
    }
    if (item.kind === 'desk') {
      const vertical = Math.abs(item.rot % 180) === 90;
      return vertical
        ? svg`<line x1=${px + 7} y1=${py + 12} x2=${px + 7} y2=${py + ph - 12} stroke=${stroke} stroke-width="2.2" stroke-linecap="round" opacity="0.7" />`
        : svg`<line x1=${px + 12} y1=${py + 7} x2=${px + pw - 12} y2=${py + 7} stroke=${stroke} stroke-width="2.2" stroke-linecap="round" opacity="0.7" />`;
    }
    if (item.kind === 'firepit') {
      return svg`
        <circle cx=${px + pw / 2} cy=${py + ph / 2} r=${Math.min(pw, ph) * 0.28} fill="none" stroke=${stroke} stroke-width="1.4" stroke-dasharray="2 2" />
      `;
    }
    if (item.kind === 'plant') {
      return svg`
        <circle cx=${px + pw / 2} cy=${py + ph / 2} r=${Math.min(pw, ph) * 0.34} fill=${stroke} fill-opacity="0.18" />
      `;
    }
    return nothing;
  }

  private renderSeating(
    scene: SeatingScene,
    props: Record<string, unknown>,
    evaluation?: PlanEvaluation,
  ) {
    void this.seatDragTick;
    const guests = Array.isArray(props['placements'])
      ? (props['placements'] as SeatPlacement[])
      : [];
    const selectedId =
      typeof props['selectedId'] === 'string' && props['selectedId']
        ? props['selectedId']
        : (guests[0]?.id ?? '');
    const setPlacements = props['setPlacements'] as ((val: SeatPlacement[]) => void) | undefined;
    const setSelectedId = props['setSelectedId'] as ((val: string) => void) | undefined;

    const violating = new Set(evaluation?.violatingIds ?? []);
    const arcs = evaluation?.arcs ?? [];

    const tableMap = new Map(scene.tables.map(t => [t.id, t]));
    const posMap = new Map<string, {x: number; y: number}>();
    for (const g of guests) {
      const table = tableMap.get(g.tableId);
      if (table) {
        const pos = seatPosition(table, g.seatIdx);
        posMap.set(g.id, {x: pos.x, y: pos.y});
      }
    }

    const armedGuest = this.armedSwapId ? guests.find(g => g.id === this.armedSwapId) : undefined;
    const selectedGuest = guests.find(g => g.id === selectedId) ?? guests[0];

    return html`
      <div class="pc-shell">
        <div class="pc-hud">
          <span class="pc-caption">
            ${armedGuest
              ? html`Swap armed: click any other seat to swap with
                  <strong>${armedGuest.shortName}</strong>`
              : html`${guests.length} guests · ${scene.tables.length} tables · Click two seats or
                drag to swap`}
          </span>
          <div class="pc-controls" role="group" aria-label="Table seating controls">
            ${armedGuest
              ? html`
                  <button
                    type="button"
                    class="pc-ctrl"
                    @click=${() => {
                      this.armedSwapId = '';
                    }}
                  >
                    Cancel swap
                  </button>
                `
              : nothing}
            <button
              type="button"
              class="pc-ctrl"
              aria-label="Rotate table seats"
              @click=${() => {
                if (!setPlacements || !selectedGuest) return;
                const table = tableMap.get(selectedGuest.tableId);
                const count = table?.seatCount ?? 8;
                setPlacements(
                  guests.map(g =>
                    g.tableId === selectedGuest.tableId
                      ? {...g, seatIdx: (g.seatIdx + 1) % count}
                      : g,
                  ),
                );
              }}
            >
              ↻ Rotate table
            </button>
          </div>
        </div>

        <svg
          class="pc-svg"
          viewBox="0 0 ${scene.stageW} ${scene.stageH}"
          role="application"
          aria-label="${scene.title} interactive seating chart"
          @pointermove=${(e: PointerEvent) => {
            if (!this.seatDrag) return;
            const svgEl = e.currentTarget as SVGSVGElement;
            const pt = svgCoordinates(svgEl, e.clientX, e.clientY, scene.stageW, scene.stageH);
            this.seatDrag.curSvgX = pt.x;
            this.seatDrag.curSvgY = pt.y;
            if (Math.hypot(pt.x - this.seatDrag.startSvgX, pt.y - this.seatDrag.startSvgY) > 6) {
              this.seatDrag.moved = true;
            }
            let hover = '';
            let bestDist = 26;
            for (const g of guests) {
              if (g.id === this.seatDrag.guestId) continue;
              const p = posMap.get(g.id);
              if (!p) continue;
              const d = Math.hypot(pt.x - p.x, pt.y - p.y);
              if (d < bestDist) {
                bestDist = d;
                hover = g.id;
              }
            }
            this.seatDrag.hoverGuestId = hover;
            this.seatDragTick++;
          }}
          @pointerup=${(e: PointerEvent) => {
            if (!this.seatDrag) return;
            const drag = this.seatDrag;
            this.seatDrag = undefined;
            this.seatDragTick++;
            const svgEl = e.currentTarget as SVGSVGElement;
            try {
              svgEl.releasePointerCapture(e.pointerId);
            } catch {
              // Ignore synthetic events without active capture.
            }
            if (drag.moved && drag.hoverGuestId && drag.hoverGuestId !== drag.guestId) {
              setPlacements?.(swapGuestSeats(guests, drag.guestId, drag.hoverGuestId));
              setSelectedId?.(drag.guestId);
              this.armedSwapId = '';
            } else if (!drag.moved) {
              if (this.armedSwapId && this.armedSwapId !== drag.guestId) {
                const sourceId = this.armedSwapId;
                this.armedSwapId = '';
                setPlacements?.(swapGuestSeats(guests, sourceId, drag.guestId));
                setSelectedId?.(sourceId);
              } else if (this.armedSwapId === drag.guestId) {
                this.armedSwapId = '';
                setSelectedId?.(drag.guestId);
              } else {
                this.armedSwapId = drag.guestId;
                setSelectedId?.(drag.guestId);
              }
            }
          }}
          @pointercancel=${() => {
            this.seatDrag = undefined;
            this.seatDragTick++;
          }}
        >
          ${svg`
            <!-- Room landmarks -->
            ${scene.landmarks.map(
              lm => svg`
                <g>
                  <rect
                    x=${lm.x - 42}
                    y=${lm.y - 10}
                    width="84"
                    height="18"
                    rx="9"
                    fill="var(--cs-surface-alt)"
                    stroke="var(--cs-border)"
                    stroke-width="1"
                  />
                  <text
                    x=${lm.x}
                    y=${lm.y + 2.5}
                    text-anchor="middle"
                    font-size="8.5"
                    font-weight="600"
                    fill="var(--cs-muted)"
                  >
                    ${lm.label}
                  </text>
                </g>
              `,
            )}

            <!-- Banquet tables -->
            ${scene.tables.map(
              table => svg`
                <g>
                  <circle
                    cx=${table.cx}
                    cy=${table.cy}
                    r=${table.radius + 40}
                    fill="none"
                    stroke="var(--cs-border)"
                    stroke-width="0.9"
                    stroke-dasharray="3 4"
                  />
                  <circle
                    cx=${table.cx}
                    cy=${table.cy}
                    r=${table.radius}
                    fill="var(--cs-surface)"
                    stroke="var(--cs-border)"
                    stroke-width="2"
                  />
                  <text
                    x=${table.cx}
                    y=${table.cy - 3}
                    text-anchor="middle"
                    font-size="10"
                    font-weight="700"
                    fill="var(--cs-text)"
                  >
                    ${table.label.split('·')[0]?.trim() ?? table.label}
                  </text>
                  <text
                    x=${table.cx}
                    y=${table.cy + 10}
                    text-anchor="middle"
                    font-size="8.5"
                    fill="var(--cs-muted)"
                  >
                    ${table.zone === 'quiet' ? 'Quiet zone' : 'Lively zone'}
                  </text>
                </g>
              `,
            )}

            <!-- Social affinity & conflict SVG arcs -->
            ${arcs.map(arc => {
              const from = posMap.get(arc.fromId);
              const to = posMap.get(arc.toId);
              if (!from || !to) return nothing;
              const midX = (from.x + to.x) / 2;
              const midY = (from.y + to.y) / 2;
              const nearTable = scene.tables.reduce((best, t) =>
                Math.hypot(midX - t.cx, midY - t.cy) < Math.hypot(midX - best.cx, midY - best.cy)
                  ? t
                  : best,
              );
              const rdx = midX - nearTable.cx;
              const rdy = midY - nearTable.cy;
              const rlen = Math.hypot(rdx, rdy) || 1;
              const ux = rdx / rlen;
              const uy = rdy / rlen;
              const mx = midX + ux * 26;
              const my = midY + uy * 26;
              const pillX = Math.max(38, Math.min(scene.stageW - 38, midX + ux * 74));
              const pillY = Math.max(12, Math.min(scene.stageH - 11, midY + uy * 38));
              const isConflict = arc.kind === 'conflict' && !arc.satisfied;
              const strokeColor = isConflict
                ? 'var(--cs-fail-fg)'
                : arc.satisfied
                  ? 'var(--cs-pass-fg)'
                  : 'var(--cs-warn-fg)';
              return svg`
                <g pointer-events="none">
                  <path
                    d="M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}"
                    fill="none"
                    stroke=${strokeColor}
                    stroke-width=${isConflict ? '2.4' : '1.6'}
                    stroke-dasharray=${isConflict || !arc.satisfied ? '4 3' : 'none'}
                    opacity=${isConflict ? '0.95' : '0.65'}
                  />
                  ${
                    isConflict
                      ? svg`
                        <rect
                          x=${pillX - 34}
                          y=${pillY - 7.5}
                          width="68"
                          height="15"
                          rx="7.5"
                          fill="var(--cs-fail-bg)"
                          stroke="var(--cs-fail-border)"
                          stroke-width="1"
                        />
                        <text
                          x=${pillX}
                          y=${pillY + 2.5}
                          text-anchor="middle"
                          font-size="8"
                          font-weight="700"
                          fill="var(--cs-fail-fg)"
                        >
                          Conflict: ${arc.label}
                        </text>
                      `
                      : nothing
                  }
                </g>
              `;
            })}

            <!-- Live drag preview line -->
            ${
              this.seatDrag?.moved
                ? (() => {
                    const origin = posMap.get(this.seatDrag.guestId);
                    if (!origin) return nothing;
                    return svg`
                    <line
                      x1=${origin.x}
                      y1=${origin.y}
                      x2=${this.seatDrag.curSvgX}
                      y2=${this.seatDrag.curSvgY}
                      stroke="var(--cs-accent)"
                      stroke-width="2"
                      stroke-dasharray="4 3"
                      pointer-events="none"
                    />
                  `;
                  })()
                : nothing
            }

            <!-- Guest seat tokens -->
            ${guests.map(guest => {
              const pos = posMap.get(guest.id);
              if (!pos) return nothing;
              const isSelected = guest.id === selectedId;
              const isArmed = guest.id === this.armedSwapId;
              const isHovered = guest.id === this.seatDrag?.hoverGuestId;
              const isBad = violating.has(guest.id);
              const dietLabel =
                guest.diet === 'vegan'
                  ? 'V'
                  : guest.diet === 'gf'
                    ? 'GF'
                    : guest.diet === 'kid'
                      ? 'K'
                      : '';

              return svg`
                <g
                  class="pc-seat"
                  data-guest-id=${guest.id}
                  role="button"
                  tabindex="0"
                  aria-label="Seat ${guest.shortName}"
                  @pointerdown=${(e: PointerEvent) => {
                    e.stopPropagation();
                    const svgEl = (e.currentTarget as SVGGElement).ownerSVGElement;
                    if (!svgEl) return;
                    const pt = svgCoordinates(
                      svgEl,
                      e.clientX,
                      e.clientY,
                      scene.stageW,
                      scene.stageH,
                    );
                    this.seatDrag = {
                      guestId: guest.id,
                      pointerId: e.pointerId,
                      startSvgX: pt.x,
                      startSvgY: pt.y,
                      curSvgX: pt.x,
                      curSvgY: pt.y,
                      hoverGuestId: '',
                      moved: false,
                    };
                    try {
                      svgEl.setPointerCapture(e.pointerId);
                    } catch {
                      // Ignore synthetic events without active capture.
                    }
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (this.armedSwapId && this.armedSwapId !== guest.id) {
                      const sourceId = this.armedSwapId;
                      this.armedSwapId = '';
                      setPlacements?.(swapGuestSeats(guests, sourceId, guest.id));
                      setSelectedId?.(sourceId);
                    } else if (this.armedSwapId === guest.id) {
                      this.armedSwapId = '';
                      setSelectedId?.(guest.id);
                    } else {
                      this.armedSwapId = guest.id;
                      setSelectedId?.(guest.id);
                    }
                  }}
                >
                  ${
                    isSelected || isArmed || isHovered || isBad
                      ? svg`
                        <circle
                          cx=${pos.x}
                          cy=${pos.y}
                          r="20"
                          fill="none"
                          stroke=${
                            isHovered || isArmed
                              ? 'var(--cs-accent)'
                              : isBad
                                ? 'var(--cs-fail-fg)'
                                : 'var(--cs-accent)'
                          }
                          stroke-width="2"
                          stroke-dasharray=${isArmed || isHovered ? '3 2' : 'none'}
                        />
                      `
                      : nothing
                  }
                  <circle
                    cx=${pos.x}
                    cy=${pos.y}
                    r="16"
                    fill=${isBad ? 'var(--cs-fail-bg)' : 'var(--cs-bg)'}
                    stroke=${
                      isBad
                        ? 'var(--cs-fail-fg)'
                        : isSelected
                          ? 'var(--cs-accent)'
                          : 'var(--cs-border)'
                    }
                    stroke-width="1.8"
                  />
                  <text
                    x=${pos.x}
                    y=${pos.y - 1}
                    text-anchor="middle"
                    font-size="8.5"
                    font-weight="700"
                    fill="var(--cs-text)"
                    pointer-events="none"
                  >
                    ${guest.shortName}
                  </text>
                  <text
                    x=${pos.x}
                    y=${pos.y + 8.5}
                    text-anchor="middle"
                    font-size="7"
                    fill="var(--cs-muted)"
                    pointer-events="none"
                  >
                    #${guest.seatIdx + 1}${dietLabel ? `·${dietLabel}` : ''}
                  </text>
                </g>
              `;
            })}
          `}
        </svg>
      </div>
    `;
  }
}

export const A2uiPlanCanvas = {
  ...PlanCanvasApi,
  tagName: A2uiPlanCanvasElement.tagName,
  element: A2uiPlanCanvasElement,
};
