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
 * Markdown images and `<img>` elements in MDX.
 */

import {LOCAL_ASSET_DIR} from '../../scripts/fetch-doc-assets.mjs';
import {normalizeBasePrefix} from '../lib/spec-schemas.mjs';

function getReleasePrefix(manifest) {
  const base =
    manifest?.baseUrl ||
    `https://github.com/${manifest?.repo || 'a2ui-project/a2ui'}/releases/download/${manifest?.releaseTag || 'docs-assets'}`;
  return `${base.replace(/\/+$/, '')}/`;
}

/**
 * Returns the site path for a manifest release URL, the URL unchanged when it
 * is not a release download for this repository, and throws for a release URL missing
 * from the manifest so a typo fails the build instead of hot-linking GitHub.
 */
export function localDocAssetUrl(url, manifest, basePrefix = '') {
  if (typeof url !== 'string') return url;
  const prefix = getReleasePrefix(manifest);
  if (!url.startsWith(prefix)) return url;

  const cleanUrl = url.split('?')[0].split('#')[0];
  const entry = Object.values(manifest?.assets || {}).find(asset => asset.url === cleanUrl);
  if (!entry) {
    throw new Error(
      `Release asset ${url} is not listed in docs/site/assets-manifest.json. Upload it with scripts/upload-doc-asset.mjs.`,
    );
  }
  const cleanBase = normalizeBasePrefix(basePrefix);
  return `${cleanBase}/${LOCAL_ASSET_DIR}/${entry.filename}`;
}

export function findManifestEntry(url, manifest) {
  if (typeof url !== 'string') return null;
  const prefix = getReleasePrefix(manifest);
  if (!url.startsWith(prefix)) return null;
  const cleanUrl = url.split('?')[0].split('#')[0];
  return Object.values(manifest?.assets || {}).find(asset => asset.url === cleanUrl) || null;
}

function rewrite(node, manifest, basePrefix) {
  if (!node || typeof node !== 'object') return;

  // Handle raw HTML strings in Markdown (e.g. <img src="..."> in .md files)
  if (node.type === 'raw' && typeof node.value === 'string') {
    const prefix = getReleasePrefix(manifest);
    // Escape prefix for regex
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedPrefix}[^\\s"'>]+`, 'g');
    node.value = node.value.replace(regex, matchedUrl =>
      localDocAssetUrl(matchedUrl, manifest, basePrefix),
    );
  }

  if (node.type === 'element' && node.tagName === 'img' && node.properties) {
    const originalSrc = node.properties.src;
    const entry = findManifestEntry(originalSrc, manifest);
    node.properties.src = localDocAssetUrl(originalSrc, manifest, basePrefix);
    if (entry) {
      if (entry.width && node.properties.width == null) {
        node.properties.width = entry.width;
      }
      if (entry.height && node.properties.height == null) {
        node.properties.height = entry.height;
      }
    }
  }
  if (
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
    node.name === 'img'
  ) {
    node.attributes = node.attributes || [];
    const srcAttr = node.attributes.find(
      attr => attr.name === 'src' && typeof attr.value === 'string',
    );
    if (srcAttr) {
      const originalSrc = srcAttr.value;
      srcAttr.value = localDocAssetUrl(originalSrc, manifest, basePrefix);
      const entry = findManifestEntry(originalSrc, manifest);
      if (entry) {
        const hasWidth = node.attributes.some(attr => attr.name === 'width');
        const hasHeight = node.attributes.some(attr => attr.name === 'height');
        if (entry.width && !hasWidth) {
          node.attributes.push({
            type: 'mdxJsxAttribute',
            name: 'width',
            value: String(entry.width),
          });
        }
        if (entry.height && !hasHeight) {
          node.attributes.push({
            type: 'mdxJsxAttribute',
            name: 'height',
            value: String(entry.height),
          });
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) rewrite(child, manifest, basePrefix);
  }
}

export function rehypeLocalDocAssets({manifest, basePrefix = ''}) {
  return function transformer(tree) {
    rewrite(tree, manifest, basePrefix);
  };
}
