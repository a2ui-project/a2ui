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

/** The schemes of the links the app asks the host to open. */
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Returns the link `event` follows, or `undefined` when it follows none. */
export function clickedLink(event: Event): HTMLAnchorElement | undefined {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLAnchorElement && target.hasAttribute('href')) return target;
  }
  return undefined;
}

/** Tells whether the host may open `url`: an absolute `http:`, `https:` or `mailto:` URL. */
export function isOpenableUrl(url: string): boolean {
  return URL.canParse(url) && OPENABLE_PROTOCOLS.has(new URL(url).protocol);
}
