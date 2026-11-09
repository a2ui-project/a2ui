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
/**
 * Where the site serves `docs-assets` release images from. The build downloads
 * them into `public/docs-assets/` (`scripts/fetch-doc-assets.mjs`); when a
 * download failed, pages fall back to the release URL so a GitHub outage never
 * blocks a build.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Downloaded copies, relative to the site root (the build's working directory). */
export const LOCAL_DOC_ASSETS_DIR = path.resolve(process.cwd(), 'public/docs-assets');

export function hasLocalCopy(filename, dir = LOCAL_DOC_ASSETS_DIR) {
  return fs.existsSync(path.join(dir, filename));
}

/**
 * The `src` for a manifest entry: the site's own copy when the build has it,
 * otherwise the release URL.
 */
export function docAssetSrc(entry, basePrefix = '', isLocal = hasLocalCopy) {
  return isLocal(entry.filename) ? `${basePrefix}/docs-assets/${entry.filename}` : entry.url;
}
