/*
 * Copyright 2026 Google LLC
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
 * Reports the height the app's content needs whenever it changes, at most once per animation
 * frame, so the host can grow the frame (`ui/resize`). Returns a function that stops watching.
 */
export function watchContentHeight(
  element: HTMLElement,
  onHeight: (height: number) => void,
): () => void {
  if (typeof ResizeObserver === 'undefined') {
    return () => {};
  }
  let lastHeight = -1;
  let scheduled = false;
  const report = () => {
    scheduled = false;
    const style = getComputedStyle(element);
    const height = Math.ceil(
      element.scrollHeight +
        parseFloat(style.marginTop || '0') +
        parseFloat(style.marginBottom || '0'),
    );
    if (height !== lastHeight) {
      lastHeight = height;
      onHeight(height);
    }
  };
  const observer = new ResizeObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(report);
    }
  });
  observer.observe(element);
  return () => observer.disconnect();
}
