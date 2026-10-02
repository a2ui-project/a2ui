/*
 * Copyright 2026 Google LLC
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

import path from 'path';

import {FileSystemCatalogProvider, type SchemaCatalog} from '@a2ui/agent';

import {getRepoRootDir} from './tools.js';
import {VERSIONS, type VersionProfile} from './versions.js';

/** The basic catalog of each served version, keyed by version. */
export type BasicCatalogs = ReadonlyMap<VersionProfile['version'], SchemaCatalog>;

/**
 * Loads the basic catalog of every served version from the repository.
 *
 * `@a2ui/agent` bundles no catalog, so the agent loads the published documents itself.
 * The v0.9 document states neither a `catalogId` nor a `protocolVersion`, so both come
 * from the version profile.
 */
export async function loadBasicCatalogs(
  repoRoot: string = getRepoRootDir(),
): Promise<BasicCatalogs> {
  const catalogs = new Map<VersionProfile['version'], SchemaCatalog>();
  for (const profile of VERSIONS) {
    const provider = new FileSystemCatalogProvider(
      path.join(repoRoot, profile.basicCatalogPath),
      profile.version,
      profile.basicCatalogId,
    );
    catalogs.set(profile.version, await provider.load());
  }
  return catalogs;
}
