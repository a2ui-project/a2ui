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

/**
 * Validates that a media URL uses an allowed `http:`, `https:`, or `data:` scheme
 * (including relative URLs resolved against an `http(s)` base location).
 * Returns the trimmed URL string if valid, or `undefined` if disallowed or invalid.
 */
export function sanitizeMediaUrl(urlInput: unknown): string | undefined {
  if (typeof urlInput !== 'string') {
    return undefined;
  }
  const trimmed = urlInput.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
    return undefined;
  }

  const baseHref = 'https://example.invalid/';

  let parsed: URL;
  try {
    parsed = new URL(trimmed, baseHref);
  } catch {
    return undefined;
  }

  const isAllowedHttp =
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (/^https?:\/\//i.test(trimmed) ||
      (parsed.origin === 'https://example.invalid' &&
        !/^https?:/i.test(trimmed.replace(/[\t\n\r]/g, ''))));
  if (parsed.protocol !== 'data:' && !isAllowedHttp) {
    return undefined;
  }

  return trimmed;
}
