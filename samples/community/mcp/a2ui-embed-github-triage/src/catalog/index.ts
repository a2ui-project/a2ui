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

/** The triage sample catalog: the basic catalog plus GitHub components and a Vega-Lite chart. */

import {A2uiVegaChartV1} from '@a2ui/catalog-vegachart/v1';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v1_0';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiAvatar} from './avatar.js';
import {TRIAGE_CATALOG_ID} from './catalog_id.js';
import {A2uiCheckStatus} from './check_status.js';
import {A2uiDiffStat} from './diff_stat.js';
import {A2uiLabelChip} from './label_chip.js';

export {TRIAGE_CATALOG_ID} from './catalog_id.js';

/**
 * Basic components except `Icon`: its Material Symbols font cannot load under
 * the default MCP Apps CSP, so the custom components draw inline SVG instead.
 */
const basicComponents = [...basicCatalog.components.values()].filter(
  component => component.name !== 'Icon',
);

export const triageCatalog = new Catalog<WebComponentImplementation>(
  TRIAGE_CATALOG_ID,
  '1.0',
  [...basicComponents, A2uiLabelChip, A2uiAvatar, A2uiCheckStatus, A2uiDiffStat, A2uiVegaChartV1],
  [...basicCatalog.functions.values()],
  {
    themeSchema: basicCatalog.themeSchema,
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: TRIAGE_CATALOG_ID,
    title: 'A2UI GitHub Triage Sample Catalog',
    description:
      'The basic catalog without Icon, plus GitHub LabelChip, Avatar, CheckStatus and DiffStat components and a Vega-Lite VegaChart.',
  },
);
