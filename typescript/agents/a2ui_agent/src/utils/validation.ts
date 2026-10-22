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
 * Stateless validation of the payloads that an agent sends.
 */

import {CatalogApi} from '../internal/web-core.js';
import {RendererState} from './renderer-state.js';

/**
 * The state of a renderer that `validatePayload` knows nothing about.
 *
 * A surface the payload updates without creating is assumed to exist, holding components
 * the check never saw. The state creates an empty placeholder for it, on the first catalog
 * that defines the update's components and accepts it. Each component is still checked
 * against that catalog, but the surface's tree is not: references to components outside
 * the payload, a missing root and unreachable components are accepted there.
 */
class PayloadState extends RendererState {
  protected override get assumesUnknownSurfaces(): boolean {
    return true;
  }
}

/**
 * Checks a payload the way a renderer holding the catalogs would.
 *
 * The check is stateless: it sees one payload, with no record of what earlier payloads
 * sent. A surface that the payload creates with `createSurface` is checked in full, so its
 * components must be valid and reachable from the root, and their references must resolve
 * once every message in the payload is applied: a component may name a child that a later
 * message adds. A surface that the payload only updates may already hold components, so
 * references to components outside the payload and a missing root are accepted there. Each
 * of its components is still checked against a catalog that defines all of them, and the
 * surface passes if one such catalog accepts it.
 *
 * To check a payload against what earlier payloads sent, keep a `RendererState` and call
 * its `apply` and `checkTopology` inside `state.transaction(...)`, so that a rejected
 * response is rolled back whole.
 *
 * Each message must match the protocol's message schema and state a `version` that the
 * catalogs' protocol version accepts, spelled as the specification spells it: `v0.9` or
 * `v0.9.1` for v0.9 and v0.9.1, and `v1.0` for v1.0.
 *
 * @param catalogs The active catalogs, which must target compatible protocol versions. Each
 *     surface is checked against the catalog its `catalogId` names.
 * @param payload One message, or an iterable of messages, as parsed JSON objects.
 * @throws {A2uiValidationError} If a renderer holding the catalogs would reject the payload.
 *     The error, or a subclass such as `A2uiIntegrityError`, describes the first problem
 *     found.
 * @throws {A2uiCatalogError} If no catalogs are given, or if their messages state different
 *     versions, for example v0.9 and v1.0 catalogs.
 */
export function validatePayload(catalogs: CatalogApi[], payload: unknown): void {
  const state = new PayloadState(catalogs);
  state.checkTopology(state.apply(payload));
}
