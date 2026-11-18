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

import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, it} from 'node:test';
import {loadCatalogSchemaFile} from './load_catalog_schema_file.js';

const SCHEMA_FILE = {
  contractVersion: '1.0',
  catalogs: {'example.com:catalog': {components: {}}},
};

function writeTempFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'a2ui-embed-')), 'app.catalog.json');
  writeFileSync(path, content);
  return path;
}

describe('loadCatalogSchemaFile', () => {
  it('accepts the parsed content', () => {
    assert.deepEqual(loadCatalogSchemaFile(SCHEMA_FILE), SCHEMA_FILE);
  });

  it('reads a file from a path or a URL', () => {
    const path = writeTempFile(JSON.stringify(SCHEMA_FILE));
    assert.deepEqual(loadCatalogSchemaFile(path), SCHEMA_FILE);
    assert.deepEqual(loadCatalogSchemaFile(pathToFileURL(path)), SCHEMA_FILE);
  });

  it('accepts a newer minor contract version', () => {
    assert.doesNotThrow(() => loadCatalogSchemaFile({...SCHEMA_FILE, contractVersion: '1.7'}));
  });

  it('rejects a missing file', () => {
    assert.throws(
      () => loadCatalogSchemaFile('/nonexistent/app.catalog.json'),
      /The catalog schema file "\/nonexistent\/app.catalog.json" could not be read/,
    );
  });

  it('rejects a file that is not JSON', () => {
    assert.throws(() => loadCatalogSchemaFile(writeTempFile('{')), /could not be read/);
  });

  it('rejects content without catalogs', () => {
    assert.throws(
      () => loadCatalogSchemaFile({contractVersion: '1.0'}),
      /The catalog schema is invalid: catalogs: Required/,
    );
  });

  it('rejects an empty catalog list', () => {
    assert.throws(
      () => loadCatalogSchemaFile({contractVersion: '1.0', catalogs: {}}),
      /has no catalogs/,
    );
  });

  it('rejects another major contract version', () => {
    assert.throws(
      () => loadCatalogSchemaFile({...SCHEMA_FILE, contractVersion: '2.0'}),
      /is not supported: Contract version 2.0 is newer/,
    );
  });
});
