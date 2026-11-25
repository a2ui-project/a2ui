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
 * `PrepTrackGantt`: Parallel 45-min Sunday batch-cook SVG tracks (`Oven`, `Stovetop`,
 * `Prep counter`) or weekly training microcycle blocks, dynamically adapting task labels
 * and track placement as `/items` swaps change.
 */

import {css, html, nothing, svg} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

import type {MixItem, PrepBlock, PrepTrack} from './functions.js';

const GANTT_W = 320;
const LABEL_W = 76;
const RIGHT_PAD = 8;
const TIMELINE_W = GANTT_W - LABEL_W - RIGHT_PAD;
const HEADER_H = 18;
const ROW_H = 31;

export const PrepTrackGanttApi = {
  name: 'PrepTrackGantt',
  schema: spec(
    z
      .object({
        title: DynamicStringSchema.describe('REF:#/$defs/DynamicString|Gantt panel title.'),
        subtitle: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Short parallelism summary.',
        ).optional(),
        totalMinutes: z
          .number()
          .int()
          .min(4)
          .max(600)
          .describe('Total timeline span (minutes, hours, or phases).'),
        unitSuffix: z
          .string()
          .max(12)
          .describe('Axis tick unit suffix such as "m", "h", "mo", or "wk". Defaults to "m".')
          .optional(),
        wide: z
          .boolean()
          .describe('True when rendered full-width rather than in a 2-column split.')
          .optional(),
        tracks: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Parallel track definitions (Oven, Stovetop, Prep counter).',
        ),
        items: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional binding to /items so swap pills dynamically update Gantt blocks.',
        ).optional(),
      })
      .describe('Parallel batch-cook or microcycle SVG Gantt timeline tracks.')
      .strict(),
    {mixins: [], required: ['title', 'totalMinutes', 'tracks']},
  ),
} satisfies ComponentApi;

function parseTracks(raw: unknown): PrepTrack[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PrepTrack =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function parseItemsMap(raw: unknown): Map<string, MixItem> {
  const map = new Map<string, MixItem>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const item = entry as MixItem;
      if (typeof item.id === 'string') map.set(item.id, item);
    }
  }
  return map;
}

interface ResolvedGanttBlock {
  readonly id: string;
  readonly trackId: string;
  readonly label: string;
  readonly startMin: number;
  readonly durationMin: number;
  readonly accent: PrepBlock['accent'];
}

function resolveBlocks(
  tracks: readonly PrepTrack[],
  itemsMap: ReadonlyMap<string, MixItem>,
  totalMinutes: number,
): Map<string, ResolvedGanttBlock[]> {
  const byTrack = new Map<string, ResolvedGanttBlock[]>();
  for (const track of tracks) byTrack.set(track.id, []);

  for (const track of tracks) {
    const blocks = Array.isArray(track.blocks) ? track.blocks : [];
    for (const block of blocks) {
      const linked = block.itemId ? itemsMap.get(block.itemId) : undefined;
      const optId = linked?.activeOptionId ?? '';
      const targetTrackId =
        optId && block.optionTracks?.[optId] && byTrack.has(block.optionTracks[optId]!)
          ? block.optionTracks[optId]!
          : track.id;
      const label = (optId && block.optionLabels?.[optId]) || block.label;
      const baseDur = (optId && block.optionDurations?.[optId]) ?? block.durationMin;
      const scaleFactor = linked ? 0.85 + 0.15 * linked.scale : 1;
      const durationMin = Math.max(
        4,
        Math.min(totalMinutes - block.startMin, Math.round(baseDur * scaleFactor)),
      );
      byTrack.get(targetTrackId)?.push({
        id: block.id,
        trackId: targetTrackId,
        label,
        startMin: block.startMin,
        durationMin,
        accent: block.accent,
      });
    }
  }
  return byTrack;
}

/**
 * @cssprop [--a2ui-prep-gantt-bg=var(--color-background-secondary)] - Gantt card background.
 */
export class A2uiPrepTrackGanttElement extends A2uiLitElement<typeof PrepTrackGanttApi> {
  static readonly tagName = 'a2ui-prep-track-gantt';

  static override styles = css`
    :host {
      display: block;
    }
    .prep-gantt {
      box-sizing: border-box;
      height: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(
        --a2ui-prep-gantt-bg,
        var(--color-background-secondary, light-dark(#f6f8fc, #28292a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#e0e3e7, #3c4043));
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .prep-gantt__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .prep-gantt__title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
    }
    .prep-gantt__sub {
      font-size: 10px;
      color: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .prep-gantt__svg {
      width: 100%;
      height: auto;
      display: block;
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      border-radius: 7px;
      border: 1px solid var(--color-border-primary, light-dark(#e6e9ef, #36393d));
    }
    .prep-gantt__tick-line {
      stroke: var(--color-border-primary, light-dark(#eceff4, #303338));
      stroke-width: 1;
    }
    .prep-gantt__tick-text {
      font-size: 8.5px;
      fill: var(--color-text-secondary, light-dark(#5f6368, #a8abb0));
    }
    .prep-gantt__track-label {
      font-size: 9.5px;
      font-weight: 600;
      fill: var(--color-text-primary, light-dark(#2d3136, #d8dbe0));
    }
    .prep-gantt__lane {
      fill: var(--color-background-secondary, light-dark(#f8f9fb, #242628));
    }
    .prep-gantt__bar[data-accent='blue'] {
      fill: light-dark(#d2e3fc, #24436f);
      stroke: light-dark(#1a73e8, #8ab4f8);
    }
    .prep-gantt__bar[data-accent='teal'] {
      fill: light-dark(#ceead6, #1e462b);
      stroke: light-dark(#188038, #81c995);
    }
    .prep-gantt__bar[data-accent='amber'] {
      fill: light-dark(#feefc3, #4c3912);
      stroke: light-dark(#d97706, #fdd663);
    }
    .prep-gantt__bar[data-accent='violet'] {
      fill: light-dark(#e9d5ff, #3e285c);
      stroke: light-dark(#7c3aed, #c4b5fd);
    }
    .prep-gantt__bar-text {
      font-size: 8.5px;
      font-weight: 600;
      fill: var(--color-text-primary, light-dark(#1f1f1f, #eef0f2));
      pointer-events: none;
    }
  `;

  protected override readonly api = PrepTrackGanttApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const title = typeof props['title'] === 'string' ? props['title'] : 'Parallel prep tracks';
    const subtitle = typeof props['subtitle'] === 'string' ? props['subtitle'] : '';
    const totalMinutes = typeof props['totalMinutes'] === 'number' ? props['totalMinutes'] : 45;
    const unitSuffix = typeof props['unitSuffix'] === 'string' ? props['unitSuffix'] : 'm';
    const isWide = Boolean(props['wide']);
    const ganttW = isWide ? 620 : GANTT_W;
    const labelW = isWide ? 96 : LABEL_W;
    const timelineW = ganttW - labelW - RIGHT_PAD;
    const rowH = isWide ? 26 : ROW_H;
    const tracks = parseTracks(props['tracks']);
    const itemsMap = parseItemsMap(props['items']);
    const resolvedByTrack = resolveBlocks(tracks, itemsMap, totalMinutes);
    const svgHeight = HEADER_H + tracks.length * rowH + 6;
    const ticks = [
      0,
      Math.round(totalMinutes / 3),
      Math.round((totalMinutes * 2) / 3),
      totalMinutes,
    ];

    return html`
      <div class="prep-gantt" role="group" aria-label=${title}>
        <div class="prep-gantt__head">
          <span class="prep-gantt__title">${title}</span>
          <span class="prep-gantt__sub"
            >${subtitle || `${totalMinutes}${unitSuffix} parallel window`}</span
          >
        </div>

        <svg class="prep-gantt__svg" viewBox=${`0 0 ${ganttW} ${svgHeight}`}>
          ${ticks.map(tick => {
            const x = labelW + (tick / totalMinutes) * timelineW;
            const anchor = tick === 0 ? 'start' : tick === totalMinutes ? 'end' : 'middle';
            return svg`
              <line
                class="prep-gantt__tick-line"
                x1=${x.toFixed(1)}
                y1=${HEADER_H}
                x2=${x.toFixed(1)}
                y2=${svgHeight - 4}
              />
              <text
                class="prep-gantt__tick-text"
                x=${x.toFixed(1)}
                y="12"
                text-anchor=${anchor}
              >
                ${tick}${unitSuffix}
              </text>
            `;
          })}
          ${tracks.map((track, rowIdx) => {
            const rowTop = HEADER_H + rowIdx * rowH;
            const blocks = resolvedByTrack.get(track.id) ?? [];
            return svg`
              <g data-track-id=${track.id}>
                <rect
                  class="prep-gantt__lane"
                  x=${labelW}
                  y=${rowTop + 3}
                  width=${timelineW}
                  height=${rowH - 6}
                  rx="5"
                />
                <text class="prep-gantt__track-label" x="6" y=${rowTop + rowH / 2 + 3}>
                  ${track.name}
                </text>
                ${blocks.map(block => {
                  const bx = labelW + (block.startMin / totalMinutes) * timelineW;
                  const bw = Math.max(24, (block.durationMin / totalMinutes) * timelineW);
                  return svg`
                    <g data-block-id=${block.id}>
                      <rect
                        class="prep-gantt__bar"
                        data-accent=${block.accent}
                        x=${bx.toFixed(1)}
                        y=${rowTop + 4}
                        width=${bw.toFixed(1)}
                        height=${rowH - 8}
                        rx="4"
                        stroke-width="1"
                      />
                      <text
                        class="prep-gantt__bar-text"
                        x=${(bx + 5).toFixed(1)}
                        y=${rowTop + rowH / 2 + 3}
                      >
                        ${block.label}
                      </text>
                    </g>
                  `;
                })}
              </g>
            `;
          })}
        </svg>
      </div>
    `;
  }
}

export const A2uiPrepTrackGantt = {
  ...PrepTrackGanttApi,
  tagName: A2uiPrepTrackGanttElement.tagName,
  element: A2uiPrepTrackGanttElement,
};
