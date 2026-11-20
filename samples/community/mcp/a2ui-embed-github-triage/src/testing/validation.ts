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

/** Test helpers: validates A2UI messages against the triage catalog schema, as the server does. */

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {CONTRACT_VERSION, type CatalogSchemaFile} from '@a2ui/embed/contract';
import {createA2uiApp, type A2uiApp} from '@a2ui/embed/mcp/server';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {TRIAGE_CATALOG_ID, triageCatalog} from '../catalog/index.js';
import type {A2uiMessage} from '../compose/a2ui.js';

/** The catalog schema file the build writes, generated from the same catalog. */
export function catalogSchemaFile(): CatalogSchemaFile {
  return {
    contractVersion: CONTRACT_VERSION,
    catalogs: {[TRIAGE_CATALOG_ID]: triageCatalog.validationSchema},
  } as CatalogSchemaFile;
}

let validator: A2uiApp | undefined;

/** Validates messages with the library's server-side validator; returns the error messages. */
export function validationErrors(messages: readonly A2uiMessage[]): string[] {
  validator ??= createA2uiApp(new McpServer({name: 'validator', version: '0.0.0'}), {
    html: {text: '<!doctype html>'},
    catalogSchema: catalogSchemaFile(),
  });
  const result = validator.validate(messages as unknown as Parameters<A2uiApp['validate']>[0]);
  return result.errors.map(error => error.message);
}

/**
 * Writes an app HTML placeholder and the catalog schema file to a temp
 * directory, so the server can start without `yarn build`. Returns the HTML path.
 */
export function writeTestAppFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a2ui-triage-test-'));
  const html = join(dir, 'a2ui-app.html');
  writeFileSync(html, '<!doctype html><title>test</title>');
  writeFileSync(join(dir, 'a2ui-app.catalog.json'), JSON.stringify(catalogSchemaFile()));
  return html;
}

/** Every component of every `updateComponents` message. */
export function allComponents(messages: readonly A2uiMessage[]): Array<Record<string, unknown>> {
  return messages.flatMap(message =>
    'updateComponents' in message
      ? (message.updateComponents.components as unknown as Array<Record<string, unknown>>)
      : [],
  );
}

/** The merged initial data model of a surface. */
export function dataModelOf(
  messages: readonly A2uiMessage[],
  surfaceId: string,
): Record<string, unknown> {
  const model: Record<string, unknown> = {};
  for (const message of messages) {
    if ('updateDataModel' in message && message.updateDataModel.surfaceId === surfaceId) {
      const {path, value} = message.updateDataModel;
      if (path === undefined) Object.assign(model, value as object);
      else model[path.slice(1)] = value;
    }
  }
  return model;
}
