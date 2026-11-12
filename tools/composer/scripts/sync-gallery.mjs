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
 * Syncs gallery widget data from the canonical spec examples.
 *
 * Reads JSON examples from specification/v0_9 catalogs and
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
const V09_EXAMPLES = join(ROOT, 'specification/v0_9/catalogs/basic/examples');
const V09_OUT = join(__dirname, '../src/data/gallery/v09/generated.ts');
const THEATER_OUT = join(__dirname, '../src/data/theater/generated.ts');

const THEATER_SCENARIO_FILES = [
  '31_incremental-dashboard.json',
  '30_live-invitation-builder.json',
  '01_flight-status.json',
  '20_restaurant-card.json',
  '25_contact-card.json',
];

const LICENSE = `/**
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

function applyUpdateDataModel(data, {path, value}) {
  if (!path || path === '/') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return structuredClone(value);
    }
    return {};
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return data;
  const next = structuredClone(data);
  let curr = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (curr[key] === undefined || curr[key] === null || typeof curr[key] !== 'object') {
      const nextKey = parts[i + 1];
      curr[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    curr = curr[key];
  }
  const lastKey = parts[parts.length - 1];
  if (value === undefined) {
    if (Array.isArray(curr) && /^\d+$/.test(lastKey)) {
      curr.splice(Number(lastKey), 1);
    } else {
      delete curr[lastKey];
    }
  } else {
    curr[lastKey] = value;
  }
  return next;
}

/**
 * Extract widget data from v0.9 messages ({ name, description, messages }).
 */
function parseV09(example, slug) {
  const componentsMap = new Map();
  let data = {};

  for (const msg of example.messages) {
    if (msg.updateComponents?.components) {
      for (const comp of msg.updateComponents.components) {
        if (comp?.id) {
          componentsMap.set(comp.id, comp);
        }
      }
    }
    if (msg.updateDataModel) {
      data = applyUpdateDataModel(data, msg.updateDataModel);
    }
  }

  return {
    id: `gallery-v09-${slug}`,
    name: example.name || slugToName(slug),
    description: example.description || '',
    specVersion: '0.9',
    root: 'root',
    components: Array.from(componentsMap.values()),
    data,
  };
}

function generateFile(examplesDir, parser) {
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

  const arrayName = 'V09_GALLERY_WIDGETS';
  const arrayEntries = widgets
    .map(({slug}) => `  ${slug.toUpperCase().replace(/-/g, '_')},`)
    .join('\n');

  return `${LICENSE}

// AUTO-GENERATED by scripts/sync-gallery.mjs — do not edit manually.
// Source: specification/v0_9/catalogs/basic/examples/

import type { Widget } from '@/types/widget';

type GalleryEntry = { widget: Widget; height: number };
${entries.join('\n')}

export const ${arrayName}: GalleryEntry[] = [
${arrayEntries}
];
`;
}

function generateTheaterFile(examplesDir) {
  const entries = THEATER_SCENARIO_FILES.map(file => {
    const slug = file.replace(/^\d+_/, '').replace('.json', '');
    const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf-8'));
    const messagesJson = JSON.stringify(raw.messages, null, 2).replace(/\n/g, '\n  ');
    return `  '${slug}': ${messagesJson},`;
  });

  return `${LICENSE}

// AUTO-GENERATED by scripts/sync-gallery.mjs — do not edit manually.
// Source: specification/v0_9/catalogs/basic/examples/

export const scenarios = {
${entries.join('\n')}
};

export type ScenarioId = keyof typeof scenarios;
`;
}

const v09 = generateFile(V09_EXAMPLES, parseV09);
writeFileSync(V09_OUT, v09);
console.log(`[sync-gallery] v0.9: wrote ${V09_OUT}`);

const theater = generateTheaterFile(V09_EXAMPLES);
writeFileSync(THEATER_OUT, theater);
console.log(`[sync-gallery] theater: wrote ${THEATER_OUT}`);
