/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {PermissiveUrlSecurityPolicy} from '@a2ui/web_core';

// v0.8 surfaces have no URL security policy, so media URLs get the built-in
// baseline checks only.
const BASELINE_URL_POLICY = new PermissiveUrlSecurityPolicy();

/**
 * Returns a media URL if it passes the built-in URL security baseline checks
 * (for example, it rejects `javascript:` URLs, hostless `https:` URLs, and SVG
 * data URLs), or `null` if it doesn't.
 *
 * @param url The resolved URL.
 */
export function checkMediaUrl(url: string | null): string | null {
  return (url && BASELINE_URL_POLICY.sanitizeUrl(url, 'media')) || null;
}
