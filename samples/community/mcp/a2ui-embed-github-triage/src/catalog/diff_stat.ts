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

/** The `DiffStat` component: added and deleted line counts with a GitHub-style block bar. */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicNumberSchema, spec} from '@a2ui/web_core/v1_0';

/** Component API of `DiffStat`. */
export const DiffStatApi = {
  name: 'DiffStat',
  schema: spec(
    z
      .object({
        additions: DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|Lines added.'),
        deletions: DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|Lines deleted.'),
        blocks: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe('Optional number of blocks in the bar. Defaults to 5.')
          .optional(),
      })
      .describe('Added and deleted line counts with a bar of green and red blocks.')
      .strict(),
    {mixins: [], required: ['additions', 'deletions']},
  ),
} satisfies ComponentApi;

/** Splits `blocks` into added, deleted and unchanged blocks, as GitHub's diff stat does. */
export function diffBlocks(
  additions: number,
  deletions: number,
  blocks: number,
): {added: number; deleted: number; neutral: number} {
  const total = additions + deletions;
  if (total <= 0) return {added: 0, deleted: 0, neutral: blocks};
  let added = Math.floor((additions / total) * blocks);
  let deleted = Math.floor((deletions / total) * blocks);
  if (additions > 0 && added === 0) added = 1;
  if (deletions > 0 && deleted === 0) deleted = 1;
  while (added + deleted > blocks) {
    if (added >= deleted) added--;
    else deleted--;
  }
  return {added, deleted, neutral: blocks - added - deleted};
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** `DiffStat` element. */
export class A2uiDiffStatElement extends A2uiLitElement<typeof DiffStatApi> {
  static readonly tagName = 'a2ui-triage-diff-stat';

  static override styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    .stat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .add {
      color: #1a7f37;
    }
    .del {
      color: #cf222e;
    }
    .bar {
      display: inline-flex;
      gap: 1px;
    }
    .bar i {
      width: 8px;
      height: 8px;
      background: #d0d7de;
    }
    .bar i.a {
      background: #1a7f37;
    }
    .bar i.d {
      background: #cf222e;
    }
  `;

  protected override readonly api = DiffStatApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const additions = count(props.additions);
    const deletions = count(props.deletions);
    const {added, deleted, neutral} = diffBlocks(additions, deletions, props.blocks ?? 5);
    const bar = [
      ...Array.from({length: added}, () => 'a'),
      ...Array.from({length: deleted}, () => 'd'),
      ...Array.from({length: neutral}, () => ''),
    ];
    return html`<span
      class="stat"
      aria-label=${`${additions} lines added, ${deletions} lines deleted`}
      ><span class="add">+${additions.toLocaleString('en-US')}</span
      ><span class="del">−${deletions.toLocaleString('en-US')}</span
      ><span class="bar" aria-hidden="true"
        >${bar.map(kind => html`<i class=${kind}></i>`)}</span
      ></span
    >`;
  }
}

/** `DiffStat` implementation for the triage catalog. */
export const A2uiDiffStat = {
  ...DiffStatApi,
  tagName: A2uiDiffStatElement.tagName,
  element: A2uiDiffStatElement,
};
