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
 * Allowlist checks of the bridge (bridge protocol section 4) and the path checks of section 8.
 */

import {FORBIDDEN_PROTOTYPE_KEYS} from './shared/sandbox/payload_validation.js';

/**
 * Whether `path` is allowed by the component's `dataPaths`: equal to an entry, or below one.
 * Without an allowlist no path is allowed.
 */
export function isPathAllowed(path: string, allowlist: readonly string[] | undefined): boolean {
  return (allowlist ?? []).some(entry => {
    const prefix = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

/**
 * Whether `name` is in the component's `functions` or `actions`. Without an allowlist no name
 * is allowed.
 */
export function isNameAllowed(name: string, allowlist: readonly string[] | undefined): boolean {
  return allowlist?.includes(name) ?? false;
}

/** Whether a JSON pointer has a segment that could pollute prototypes once unescaped. */
export function hasForbiddenSegment(path: string): boolean {
  return path
    .split('/')
    .some(segment => FORBIDDEN_PROTOTYPE_KEYS.has(segment.replace(/~1/g, '/').replace(/~0/g, '~')));
}
