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
 * The inbox sample catalog: the basic catalog (with a taller multi-line
 * TextField), an initials `Avatar`, a `BusyNote` status line and the
 * `byChoice` function.
 */

import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v1_0';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiAvatar} from './avatar.js';
import {A2uiBusyNote} from './busy_note.js';
import {byChoice} from './functions.js';
import {A2uiInboxTextField} from './text_field.js';
import {INBOX_CATALOG_ID} from './catalog_id.js';

export {INBOX_CATALOG_ID} from './catalog_id.js';

/**
 * Basic components except `Icon` (its Material Symbols font cannot load under
 * the default MCP Apps CSP) and `TextField` (replaced by a taller one).
 */
const basicComponents = [...basicCatalog.components.values()].filter(
  component => component.name !== 'Icon' && component.name !== 'TextField',
);

export const inboxCatalog = new Catalog<WebComponentImplementation>(
  INBOX_CATALOG_ID,
  '1.0',
  [...basicComponents, A2uiInboxTextField, A2uiAvatar, A2uiBusyNote],
  [...basicCatalog.functions.values(), byChoice],
  {
    themeSchema: basicCatalog.themeSchema,
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: INBOX_CATALOG_ID,
    title: 'A2UI Inbox Sample Catalog',
    description:
      'The basic catalog without Icon and with a taller multi-line TextField, plus an initials Avatar, a BusyNote status line and the byChoice function.',
  },
);
