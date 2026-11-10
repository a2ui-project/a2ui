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

import {Catalog, type WebComponentImplementation} from '@a2ui/web_core/v1_0';
import {A2uiFileUpload, FileReferenceSchema} from './components/file_upload.js';

/** Identifier of the A2UI File Upload catalog schema (`catalogs/file_upload/catalog.json`). */
export const FILE_UPLOAD_CATALOG_ID =
  'https://a2ui.org/specification/v1_0/catalogs/file_upload/catalog.json';

/**
 * The A2UI File Upload catalog (`FileUpload` universal component), ready to
 * register alongside `basicCatalog` on a `MessageProcessor` or web renderer.
 *
 * Configure host upload delegation once at startup with
 * `configureFileUploadCatalog({uploader})`. Without an uploader, files up to
 * `maxInlineSize` fall back to `inline://<uuid>` pointers with a data URI in
 * `inlineData`.
 */
export const fileUploadCatalog = new Catalog<WebComponentImplementation>(
  FILE_UPLOAD_CATALOG_ID,
  '1.0',
  [A2uiFileUpload],
  [],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: FILE_UPLOAD_CATALOG_ID,
    title: 'A2UI File Upload Catalog',
    description:
      'A2UI catalog for uploading files from a surface. It defines the `FileUpload` component, an input that lets the user pick or drop files, hands them to the host application to upload, and writes a list of file references (a pointer per file, never the bytes) to the data model.',
    defModels: [FileReferenceSchema],
  },
);
