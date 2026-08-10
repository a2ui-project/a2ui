/*
 * Copyright 2026 Google LLC
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

import {Catalog, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {z} from 'zod';
import {FileUploadComponent} from '../components/file-upload/file-upload';

export const FILE_UPLOAD_CATALOG_ID =
  'https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json';

const FileUploadSchema = z
  .object({
    label: DynamicStringSchema.optional().describe(
      'The text label or prompt displayed on the file upload drop zone (e.g., "Drag and drop files or click to upload").',
    ),
    accept: DynamicStringSchema.optional().describe(
      'Comma-separated list of allowed MIME types or file extensions (e.g., "image/*, application/pdf").',
    ),
    maxSize: DynamicNumberSchema.optional().describe(
      'Maximum allowed file size in bytes for each uploaded file.',
    ),
    multiple: z
      .boolean()
      .optional()
      .describe(
        'Whether multiple files can be selected and uploaded concurrently. Defaults to false.',
      ),
  })
  .describe(
    'FileUpload component for selecting and uploading files via host delegation or inline fallback.',
  );

export const DEMO_CATALOG = new Catalog(
  FILE_UPLOAD_CATALOG_ID,
  [
    ...BASIC_COMPONENTS,
    {name: 'FileUpload', component: FileUploadComponent, schema: FileUploadSchema},
  ],
  BASIC_FUNCTIONS,
);
