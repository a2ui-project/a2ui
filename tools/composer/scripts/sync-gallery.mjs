/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Syncs gallery widget data from the canonical spec examples.
 *
 * Reads JSON examples from specification/v0_8 and v0_9 catalogs and
 * generates TypeScript files that the gallery page imports.
 *
 * Run: node scripts/sync-gallery.mjs
 * Runs automatically via prebuild/predev hooks in package.json.
 */

import {readFileSync, writeFileSync, readdirSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..'); // monorepo root
const V08_EXAMPLES = join(ROOT, 'specification/v0_8/json/catalogs/basic/examples');
const V09_EXAMPLES = join(ROOT, 'specification/v0_9/catalogs/basic/examples');
const V08_OUT = join(__dirname, '../src/data/gallery/v08/generated.ts');
const V09_OUT = join(__dirname, '../src/data/gallery/v09/generated.ts');

const LICENSE = `/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */`;

// Gallery card heights per slug
const HEIGHTS = {
  'flight-status': 280,
  'email-compose': 420,
  'calendar-day': 380,
  'weather-current': 320,
  'product-card': 380,
  'music-player': 400,
  'task-card': 200,
  'user-profile': 420,
  'login-form': 340,
  'notification-permission': 240,
  'purchase-complete': 380,
  'chat-message': 380,
  'coffee-order': 420,
  'sports-player': 380,
  'account-balance': 280,
  'workout-summary': 320,
  'event-detail': 320,
  'track-list': 380,
  'software-purchase': 380,
  'restaurant-card': 340,
  'shipping-status': 380,
  'credit-card': 280,
  'step-counter': 320,
  'recipe-card': 380,
  'contact-card': 400,
  'podcast-episode': 300,
  'stats-card': 240,
  'countdown-timer': 260,
  'movie-card': 380,
};
const DEFAULT_HEIGHT = 340;

function slugToName(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Convert a single v0.8 value entry to a JS value.
 */
function convertValue(v) {
  if ('valueString' in v) return v.valueString;
  if ('valueNumber' in v) return v.valueNumber;
  if ('valueBoolean' in v) return v.valueBoolean;
  if ('valueMap' in v) return valueMapToObject(v.valueMap);
  if ('valueArray' in v) return v.valueArray.map(convertValue);
  return null;
}

/**
 * Convert v0.8 ValueMap[] to plain JS object.
 */
function valueMapToObject(contents) {
  const result = {};
  for (const item of contents) {
    result[item.key] = convertValue(item);
  }
  return result;
}

/**
 * Sanitize v0.8 components to fix values the renderer doesn't support.
 */
const V08_TEXTFIELD_TYPES = new Set(['shortText', 'number', 'date', 'longText']);
const V08_ALIGNMENTS = new Set(['start', 'center', 'end', 'stretch']);

function sanitizeV08Components(components) {
  return components.map(comp => {
    const copy = JSON.parse(JSON.stringify(comp));
    const inner = copy.component;
    if (!inner) return copy;

    for (const [type, props] of Object.entries(inner)) {
      // Fix unsupported textFieldType values
      if (
        type === 'TextField' &&
        props.textFieldType &&
        !V08_TEXTFIELD_TYPES.has(props.textFieldType)
      ) {
        props.textFieldType = 'shortText';
      }
      // Fix unsupported alignment values
      if (
        (type === 'Row' || type === 'Column') &&
        props.alignment &&
        !V08_ALIGNMENTS.has(props.alignment)
      ) {
        props.alignment = 'center';
      }
      // Ensure action is an object, not a string
      if (type === 'Button' && typeof props.action === 'string') {
        props.action = {name: props.action};
      }
    }
    return copy;
  });
}

/**
 * Extract widget data from v0.8 messages (bare array).
 */
function parseV08(messages, slug) {
  let components = [];
  let data = {};
  let root = 'root';

  for (const msg of messages) {
    if (msg.surfaceUpdate) components = sanitizeV08Components(msg.surfaceUpdate.components);
    if (msg.dataModelUpdate?.contents) data = valueMapToObject(msg.dataModelUpdate.contents);
    if (msg.beginRendering?.root) root = msg.beginRendering.root;
  }

  return {
    id: `gallery-${slug}`,
    name: slugToName(slug),
    specVersion: '0.8',
    root,
    components,
    data,
  };
}

/**
 * Extract widget data from v0.9 messages ({ name, description, messages }).
 */
function parseV09(example, slug) {
  let components = [];
  let data = {};

  for (const msg of example.messages) {
    if (msg.updateComponents) components = msg.updateComponents.components;
    if (msg.updateDataModel?.value) data = msg.updateDataModel.value;
  }

  return {
    id: `gallery-v09-${slug}`,
    name: example.name || slugToName(slug),
    description: example.description || '',
    specVersion: '0.9',
    root: 'root',
    components,
    data,
  };
}

function generateFile(examplesDir, version, parser) {
  const files = readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  const widgets = [];

  for (const file of files) {
    const slug = file.replace(/^\d+_/, '').replace('.json', '');
    const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf-8'));
    const parsed = parser(raw, slug);
    const height = HEIGHTS[slug] || DEFAULT_HEIGHT;
    widgets.push({slug, parsed, height});
  }

  const json = obj => JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ');

  const entries = widgets.map(({slug, parsed, height}) => {
    const constName = slug.toUpperCase().replace(/-/g, '_');
    return `
const ${constName} = {
  widget: {
    id: '${parsed.id}',
    name: ${JSON.stringify(parsed.name)},${parsed.description ? `\n    description: ${JSON.stringify(parsed.description)},` : ''}
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    specVersion: '${parsed.specVersion}' as const,
    root: '${parsed.root}',
    components: ${json(parsed.components)},
    dataStates: [{ name: 'default', data: ${json(parsed.data)} }],
  },
  height: ${height},
};`;
  });

  const arrayName = version === '0.8' ? 'V08_GALLERY_WIDGETS' : 'V09_GALLERY_WIDGETS';
  const arrayEntries = widgets
    .map(({slug}) => `  ${slug.toUpperCase().replace(/-/g, '_')},`)
    .join('\n');

  return `${LICENSE}

// AUTO-GENERATED by scripts/sync-gallery.mjs — do not edit manually.
// Source: specification/${version === '0.8' ? 'v0_8' : 'v0_9'}/json/catalogs/basic/examples/

import type { Widget } from '@/types/widget';

type GalleryEntry = { widget: Widget; height: number };
${entries.join('\n')}

export const ${arrayName}: GalleryEntry[] = [
${arrayEntries}
];
`;
}

// Generate both versions
const v08 = generateFile(V08_EXAMPLES, '0.8', parseV08);
writeFileSync(V08_OUT, v08);
console.log(`[sync-gallery] v0.8: wrote ${V08_OUT}`);

const v09 = generateFile(V09_EXAMPLES, '0.9', parseV09);
writeFileSync(V09_OUT, v09);
console.log(`[sync-gallery] v0.9: wrote ${V09_OUT}`);
