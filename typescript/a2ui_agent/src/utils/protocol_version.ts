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

import {normalizeVersionString, ProtocolVersion} from '../internal/web_core.js';

/**
 * Protocol version assumed when a catalog does not declare one.
 *
 * Catalogs compiled into web_core always carry a `protocolVersion`, but the field is
 * optional on `Catalog`, and the v0.9 catalog JSON omits it entirely. This constant is the
 * single place that decides what an undeclared version means.
 */
export const DEFAULT_PROTOCOL_VERSION = 'v1.0' as ProtocolVersion;

/**
 * Converts a catalog's declared protocol version into the form that goes on the wire.
 *
 * Catalogs spell the version inconsistently: the compiled v1.0 catalog says `v1.0`, the
 * catalog JSON says `1.0`, and directory-derived values say `v1_0`. Protocol messages
 * always carry the `v`-prefixed dotted form, so normalise on the way out.
 */
export function toWireProtocolVersion(raw: string | undefined | null): ProtocolVersion {
  const normalized = normalizeVersionString(raw);
  return normalized ? (`v${normalized}` as ProtocolVersion) : DEFAULT_PROTOCOL_VERSION;
}
