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
 * `CommitBar`: Footer bar displaying live lock/convergence status and dispatching
 * `a2ui_action` (`lock_mix`, `snap_to_targets`) and `followUp` (`build_shopping_or_action_list`).
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {
  A2uiLitElement,
  ActionSchema,
  DynamicBooleanSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  spec,
  type ComponentApi,
} from '@a2ui/web_core/v1_0';

export const CommitBarApi = {
  name: 'CommitBar',
  schema: spec(
    z
      .object({
        statusText: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Status line summarizing lock or snap state.',
        ),
        locked: DynamicBooleanSchema.describe(
          'REF:#/$defs/DynamicBoolean|Whether the current mix is locked.',
        ).optional(),
        totals: DynamicValueSchema.describe(
          'REF:#/$defs/DynamicValue|Optional live computeMixTotals result.',
        ).optional(),
        snapLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the snap_to_targets action button.',
        ).optional(),
        followUpLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the follow-up chat prompt button.',
        ).optional(),
        lockLabel: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Label for the primary lock_mix action button.',
        ).optional(),
        snapAction: ActionSchema.describe(
          'REF:#/$defs/Action|Action snapping items to target bands in place.',
        ),
        followUpAction: ActionSchema.describe(
          'REF:#/$defs/Action|Follow-up action posting a shopping or action list prompt.',
        ),
        lockAction: ActionSchema.describe(
          'REF:#/$defs/Action|Primary action locking the current mix.',
        ),
      })
      .describe(
        'Footer action bar dispatching lock_mix, snap_to_targets, and build_shopping_or_action_list.',
      )
      .strict(),
    {mixins: [], required: ['statusText', 'snapAction', 'followUpAction', 'lockAction']},
  ),
} satisfies ComponentApi;

/**
 * @cssprop [--a2ui-commit-bar-bg=var(--color-background-secondary)] - Bar background color.
 * @cssprop [--a2ui-commit-bar-primary=var(--color-ring-primary)] - Primary lock button background.
 */
export class A2uiCommitBarElement extends A2uiLitElement<typeof CommitBarApi> {
  static readonly tagName = 'a2ui-commit-bar';

  static override styles = css`
    :host {
      display: block;
    }
    .commit-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      padding: 6px 10px;
      border-radius: 9px;
      background: var(
        --a2ui-commit-bar-bg,
        var(--color-background-secondary, light-dark(#f6f8fc, #28292a))
      );
      border: 1px solid var(--color-border-primary, light-dark(#dfe3e8, #3c4043));
    }
    .commit-bar__status {
      flex: 1;
      min-width: 160px;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-secondary, light-dark(#474b50, #b8bcc2));
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .commit-bar__status[data-locked='true'] {
      color: light-dark(#137333, #81c995);
      font-weight: 600;
    }
    .commit-bar__actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .commit-bar__btn {
      padding: 5px 10px;
      border-radius: 7px;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1.2;
      cursor: pointer;
      border: 1px solid var(--color-border-primary, light-dark(#cfd4dc, #444746));
      background: var(--color-background-primary, light-dark(#ffffff, #1e1f20));
      color: var(--color-text-primary, light-dark(#1f1f1f, #e3e3e3));
    }
    .commit-bar__btn:hover {
      border-color: var(
        --a2ui-commit-bar-primary,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
    }
    .commit-bar__btn--primary {
      background: var(
        --a2ui-commit-bar-primary,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
      border-color: var(
        --a2ui-commit-bar-primary,
        var(--color-ring-primary, light-dark(#1a73e8, #8ab4f8))
      );
      color: light-dark(#ffffff, #101824);
    }
  `;

  protected override readonly api = CommitBarApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const statusText = typeof props['statusText'] === 'string' ? props['statusText'] : '';
    const locked = Boolean(props['locked']);
    const snapLabel =
      typeof props['snapLabel'] === 'string' ? props['snapLabel'] : 'Snap to targets';
    const followUpLabel =
      typeof props['followUpLabel'] === 'string' ? props['followUpLabel'] : 'Build shopping list';
    const lockLabel =
      typeof props['lockLabel'] === 'string'
        ? props['lockLabel']
        : locked
          ? '✓ Mix locked'
          : 'Lock mix';

    const snapFn = typeof props['snapAction'] === 'function' ? props['snapAction'] : undefined;
    const followUpFn =
      typeof props['followUpAction'] === 'function' ? props['followUpAction'] : undefined;
    const lockFn = typeof props['lockAction'] === 'function' ? props['lockAction'] : undefined;

    return html`
      <div class="commit-bar" data-locked=${locked ? 'true' : 'false'}>
        <div class="commit-bar__status" data-locked=${locked ? 'true' : 'false'} role="status">
          <span>${statusText}</span>
        </div>
        <div class="commit-bar__actions">
          <button type="button" class="commit-bar__btn" @click=${() => snapFn?.()}>
            ${snapLabel}
          </button>
          <button type="button" class="commit-bar__btn" @click=${() => followUpFn?.()}>
            ${followUpLabel}
          </button>
          <button
            type="button"
            class="commit-bar__btn commit-bar__btn--primary"
            @click=${() => lockFn?.()}
          >
            ${lockLabel}
          </button>
        </div>
      </div>
    `;
  }
}

export const A2uiCommitBar = {
  ...CommitBarApi,
  tagName: A2uiCommitBarElement.tagName,
  element: A2uiCommitBarElement,
};
