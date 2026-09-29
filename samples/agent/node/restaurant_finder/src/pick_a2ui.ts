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

import type {Message} from '@a2a-js/sdk';
import {basicCatalog} from '@a2ui/agent';

import {DEFAULT_VERSION, VERSIONS, type VersionProfile} from './versions.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Picks the A2UI version and catalogs to answer a message with.
 *
 * Renderers list what they can show in the message metadata, keyed by protocol version
 * (`a2uiClientCapabilities` in v0.9, `a2uiRendererCapabilities` in v1.0), so one lookup
 * gives both the version and the catalog ids. The newest version the renderer names wins.
 *
 * The A2A transport also lets a client activate the A2UI extension. Activation is
 * optional and this sample does not use it; see
 * specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md.
 *
 * @throws Error if the metadata lists capabilities only for versions this agent does not
 *     serve.
 */
export function pickA2ui(message: Message): {profile: VersionProfile; catalogIds: string[]} {
  const metadata = asRecord(message.metadata) ?? {};

  for (const profile of [...VERSIONS].reverse()) {
    const caps = asRecord(asRecord(metadata[profile.capabilitiesKey])?.[profile.version]);
    if (caps) {
      const ids = caps.supportedCatalogIds;
      const catalogIds = Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string')
        : [];
      return {profile, catalogIds};
    }
  }

  const named = VERSIONS.flatMap(p => Object.keys(asRecord(metadata[p.capabilitiesKey]) ?? {}));
  if (named.length > 0) {
    throw new Error(
      `The renderer supports A2UI ${named.join(', ')}, but this agent serves ` +
        `only ${VERSIONS.map(p => p.version).join(', ')}.`,
    );
  }

  return {profile: DEFAULT_VERSION, catalogIds: [basicCatalog(DEFAULT_VERSION.version).id]};
}
