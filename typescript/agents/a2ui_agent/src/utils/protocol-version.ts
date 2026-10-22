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

import {A2uiCatalogError} from '../errors.js';
import {normalizeVersionString, ProtocolVersion} from '../internal/web-core.js';

/**
 * Converts a catalog's declared protocol version into the form that goes on the wire.
 *
 * Catalogs spell the version inconsistently: the compiled v1.0 catalog says `v1.0`, the
 * catalog JSON says `1.0`, and directory-derived values say `v1_0`. Protocol messages
 * always carry the `v`-prefixed dotted form, so normalise on the way out.
 *
 * There is deliberately no default. A version has to be stated by whoever supplies the
 * catalog, so a new protocol release never needs a hardcoded default bumped.
 *
 * @throws {A2uiCatalogError} If `raw` is empty or missing.
 */
export function toWireProtocolVersion(raw: string | undefined | null): ProtocolVersion {
  const normalized = normalizeVersionString(raw);
  if (!normalized) {
    throw new A2uiCatalogError('A protocol version is required, but none was given.');
  }
  return `v${normalized}` as ProtocolVersion;
}

/**
 * Converts a catalog's declared protocol version into the release line it belongs to.
 *
 * v0.9 and v0.9.1 catalogs are interchangeable, as in the core's catalog compatibility, so
 * both belong to `v0.9`. Every other version is its own release line, in wire form.
 *
 * @throws {A2uiCatalogError} If `raw` is empty or missing.
 */
export function toReleaseLine(raw: string | undefined | null): ProtocolVersion {
  const wire = toWireProtocolVersion(raw);
  return wire === 'v0.9.1' ? 'v0.9' : wire;
}
