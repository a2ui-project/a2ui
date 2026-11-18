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

/** Dialogs: elements with a dialog role, such as the basic `Modal`, and open `<dialog>`s. */
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

/** The space kept above and below a dialog, in pixels. */
const DIALOG_MARGIN = 16;

/** The largest height a dialog can ask for, in pixels, so a huge dialog can't grow the frame without bound. */
const MAX_DIALOG_HEIGHT = 2000;

/**
 * Keeps `root` tall enough to show the dialogs open inside it.
 *
 * The host sizes the app's frame from the document height that the ext-apps `App` reports
 * (`autoResize`). Fixed-position overlays, such as the basic catalog's `Modal`, and top-layer
 * `<dialog>`s don't count toward that height, so a dialog open over short content is cut off.
 * While a dialog is open, this gives `root` a `min-height` large enough to show the whole dialog;
 * the `App` reports the taller document, and the `min-height` goes once every dialog is closed.
 *
 * @returns A function that stops watching and restores the `min-height` of `root`.
 */
export function keepDialogsVisible(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView!;
  const originalMinHeight = root.style.minHeight;
  let observed: Element[] = [];

  const update = () => {
    // The basic `Modal` wraps `.a2ui-modal-content` (`max-height: 80%`) inside a full-viewport
    // `<dialog open>` (`height: 100%`), so measure the content box rather than the viewport shell.
    const boxes = [...root.querySelectorAll(DIALOG_SELECTOR)].map(
      dialog => dialog.querySelector('.a2ui-modal-content') ?? dialog,
    );
    if (boxes.length !== observed.length || boxes.some((box, i) => box !== observed[i])) {
      resizes.disconnect();
      for (const box of boxes) resizes.observe(box);
      observed = boxes;
    }
    const height = Math.max(0, ...boxes.map(box => neededHeight(box, view)));
    root.style.minHeight = height > 0 ? `${height}px` : originalMinHeight;
  };

  const resizes = new view.ResizeObserver(update);
  const mutations = new view.MutationObserver(update);
  mutations.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'role'],
  });
  update();

  return () => {
    mutations.disconnect();
    resizes.disconnect();
    root.style.minHeight = originalMinHeight;
  };
}

/**
 * The frame height that shows all of `dialog`: its content height plus a margin, scaled up when its
 * `max-height` is a percentage of the frame, as the basic `Modal`'s 80% is.
 */
function neededHeight(dialog: Element, view: Window): number {
  const style = view.getComputedStyle(dialog);
  const content =
    dialog.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const fraction = style.maxHeight.endsWith('%') ? parseFloat(style.maxHeight) / 100 : 1;
  const height = Math.max(content + 2 * DIALOG_MARGIN, fraction > 0 ? content / fraction : 0);
  return Math.min(Math.ceil(height), MAX_DIALOG_HEIGHT);
}
