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
 * Pages keep writing `docs-assets` release URLs from
 * `docs/site/assets-manifest.json`. This plugin points them at the copies that
 * `scripts/fetch-doc-assets.mjs` downloads into `public/docs-assets/`, for both
 * Markdown images and `<img>` elements in MDX. An image whose download failed
 * keeps its release URL.
 */

import {docAssetSrc, hasLocalCopy} from '../lib/doc-assets.mjs';

const RELEASE_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\//;

/**
 * Returns the site path for a manifest release URL, the URL unchanged when it
 * is not a release download, and throws for a release URL missing from the
 * manifest so a typo fails the build instead of hot-linking GitHub.
 */
export function localDocAssetUrl(url, manifest, basePrefix = '', isLocal = hasLocalCopy) {
  if (typeof url !== 'string' || !RELEASE_URL_PATTERN.test(url)) return url;
  const entry = Object.values(manifest.assets || {}).find(asset => asset.url === url);
  if (!entry) {
    throw new Error(
      `Release asset ${url} is not listed in docs/site/assets-manifest.json. Upload it with scripts/upload-doc-asset.mjs.`,
    );
  }
  return docAssetSrc(entry, basePrefix, isLocal);
}

function rewrite(node, manifest, basePrefix, isLocal) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'element' && node.tagName === 'img' && node.properties) {
    node.properties.src = localDocAssetUrl(node.properties.src, manifest, basePrefix, isLocal);
  }
  if (
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
    node.name === 'img'
  ) {
    for (const attribute of node.attributes || []) {
      if (attribute.name === 'src' && typeof attribute.value === 'string') {
        attribute.value = localDocAssetUrl(attribute.value, manifest, basePrefix, isLocal);
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) rewrite(child, manifest, basePrefix, isLocal);
  }
}

export function rehypeLocalDocAssets({manifest, basePrefix = '', isLocal = hasLocalCopy}) {
  return function transformer(tree) {
    rewrite(tree, manifest, basePrefix, isLocal);
  };
}
