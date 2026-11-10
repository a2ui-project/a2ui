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

import {checkUrlBaseline} from '../security/url_security_policy.js';

/**
 * Validates that a media URL uses an allowed `http:`, `https:`, or `data:` scheme
 * (including relative URLs resolved against an `http(s)` base location).
 * Returns the trimmed URL string if valid, or `undefined` if disallowed or invalid.
 *
 * Runs the same baseline checks as the URL security policy, which also blocks
 * `data:image/svg+xml` URLs.
 *
 * @deprecated Let the resolver check URL properties (mark them with
 *   `mediaUrl()`), or call `sanitizeUrl(url, 'media')` on the component's
 *   context, which also applies the host's `UrlSecurityPolicy`.
 */
export function sanitizeMediaUrl(urlInput: unknown): string | undefined {
  if (typeof urlInput !== 'string') {
    return undefined;
  }
  return checkUrlBaseline(urlInput.trim(), 'media');
}
