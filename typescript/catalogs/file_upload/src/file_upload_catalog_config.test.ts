/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {
  configureFileUploadCatalog,
  type FileUploader,
  getFileUploadCatalogConfig,
  resetFileUploadCatalogConfig,
} from './file_upload_catalog_config.js';

describe('configureFileUploadCatalog', () => {
  afterEach(() => {
    resetFileUploadCatalogConfig();
  });

  it('starts empty and merges incremental updates until reset', () => {
    assert.deepEqual(getFileUploadCatalogConfig(), {});

    const uploader: FileUploader = {
      upload: async () => 's3://bucket/key',
    };
    configureFileUploadCatalog({uploader});
    assert.equal(getFileUploadCatalogConfig().uploader, uploader);
    assert.equal(getFileUploadCatalogConfig().maxInlineSize, undefined);

    configureFileUploadCatalog({maxInlineSize: 1024});
    assert.equal(getFileUploadCatalogConfig().uploader, uploader);
    assert.equal(getFileUploadCatalogConfig().maxInlineSize, 1024);

    resetFileUploadCatalogConfig();
    assert.deepEqual(getFileUploadCatalogConfig(), {});
  });
});
