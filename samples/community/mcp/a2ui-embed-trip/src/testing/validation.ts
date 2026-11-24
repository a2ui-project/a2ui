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

/** Test helpers for validating A2UI payloads against `tripCatalog`. */

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {CONTRACT_VERSION, type CatalogSchemaFile} from '@a2ui/embed/contract';
import {createA2uiApp, type A2uiApp} from '@a2ui/embed/mcp/server';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {TRIP_CATALOG_ID, tripCatalog} from '../catalog/index.js';
import type {A2uiMessage} from '../compose/a2ui.js';

export function catalogSchemaFile(): CatalogSchemaFile {
  return {
    contractVersion: CONTRACT_VERSION,
    catalogs: {[TRIP_CATALOG_ID]: tripCatalog.validationSchema},
  } as CatalogSchemaFile;
}

let validator: A2uiApp | undefined;

export function validationErrors(messages: readonly A2uiMessage[]): string[] {
  validator ??= createA2uiApp(new McpServer({name: 'trip-validator', version: '0.0.0'}), {
    html: {text: '<!doctype html>'},
    catalogSchema: catalogSchemaFile(),
  });
  const result = validator.validate(messages);
  return result.errors.map(error => error.message);
}

export function writeTestAppFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a2ui-trip-test-'));
  const html = join(dir, 'a2ui-app.html');
  writeFileSync(html, '<!doctype html><title>trip test</title>');
  writeFileSync(join(dir, 'a2ui-app.catalog.json'), JSON.stringify(catalogSchemaFile()));
  return html;
}
