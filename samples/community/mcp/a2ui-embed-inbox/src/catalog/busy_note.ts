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
 * The `BusyNote` component: a short status, such as "Rewriting your
 * reply…", shown while the app waits for an action the user started. The
 * `@a2ui/embed` app marks its content `aria-busy="true"` while actions are in
 * flight; the note appears when that lasts longer than a moment, so quick
 * actions don't flash it.
 */

import {css, html, nothing} from 'lit';
import {z} from 'zod';

import {A2uiLitElement, type ComponentApi, DynamicStringSchema, spec} from '@a2ui/web_core/v1_0';

/** Delay before the note shows, in milliseconds. */
export const BUSY_NOTE_DELAY_MS = 300;

/** Component API of `BusyNote`. */
export const BusyNoteApi = {
  name: 'BusyNote',
  schema: spec(
    z
      .object({
        text: DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The status shown while busy.',
        ),
      })
      .describe('A status line shown only while the app waits for an action.')
      .strict(),
    {mixins: [], required: ['text']},
  ),
} satisfies ComponentApi;

/** The closest ancestor (across shadow roots) with an `aria-busy` attribute. */
export function busyAncestor(node: Node): Element | undefined {
  let current: Node | null = node.parentNode ?? (node as unknown as {host?: Node}).host ?? null;
  while (current) {
    if (current instanceof Element && current.hasAttribute('aria-busy')) return current;
    current = current.parentNode ?? (current as unknown as {host?: Node}).host ?? null;
  }
  return undefined;
}

/** `BusyNote` element. */
export class A2uiBusyNoteElement extends A2uiLitElement<typeof BusyNoteApi> {
  static readonly tagName = 'a2ui-inbox-busy-note';

  static override properties = {busy: {state: true}};

  static override styles = css`
    :host {
      display: block;
      font-size: 12px;
      font-style: italic;
      color: var(--a2ui-text-caption-color, #5f6368);
      min-height: 16px;
    }
  `;

  protected override readonly api = BusyNoteApi;

  declare busy: boolean;
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.busy = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const target = busyAncestor(this);
    if (!target) return;
    const sync = () => {
      clearTimeout(this.timer);
      if (target.getAttribute('aria-busy') === 'true') {
        this.timer = setTimeout(() => (this.busy = true), BUSY_NOTE_DELAY_MS);
      } else {
        this.busy = false;
      }
    };
    this.observer = new MutationObserver(sync);
    this.observer.observe(target, {attributes: true, attributeFilter: ['aria-busy']});
    sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    clearTimeout(this.timer);
  }

  override render() {
    const props = this.controller?.props;
    if (!this.busy || !props || typeof props.text !== 'string') return nothing;
    return html`<span role="status">${props.text}</span>`;
  }
}

/** `BusyNote` implementation for the inbox catalog. */
export const A2uiBusyNote = {
  ...BusyNoteApi,
  tagName: A2uiBusyNoteElement.tagName,
  element: A2uiBusyNoteElement,
};
