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

import {z} from 'zod';

import {BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {
  ActionSchema,
  Catalog,
  CheckRuleSchema,
  DataBindingSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from '@a2ui/web_core/v0_9';
import {FileReferenceSchema, FileUploadComponent} from '../components/file-upload/file-upload';

/**
 * The composite catalog of the sample: the basic catalog plus `FileUpload`.
 *
 * Protocol v0.9 resolves every component of a surface from one catalog, so
 * the agent declares both under this ID in
 * `samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json`.
 * The `FileUpload` contract is the one of the A2UI File Upload catalog in
 * `catalogs/file_upload`.
 */
export const FILE_UPLOAD_CATALOG_ID =
  'https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json';

const FileUploadSchema = z
  .object({
    label: DynamicStringSchema.optional().describe(
      'The prompt shown in the drop zone (e.g., "Drop a PDF here or click to upload").',
    ),
    accept: DynamicStringSchema.optional().describe(
      'Comma-separated list of accepted MIME types or file extensions (e.g., "image/*, application/pdf").',
    ),
    maxSize: DynamicNumberSchema.optional().describe(
      'Maximum size of each file in bytes. Larger files are rejected and not uploaded.',
    ),
    multiple: z
      .boolean()
      .optional()
      .describe(
        'Whether the user may upload more than one file. When true, newly uploaded files are appended to the current list; when false, picking a new file replaces the previous one.',
      ),
    value: z
      .union([z.array(FileReferenceSchema), DataBindingSchema])
      .describe(
        'The uploaded files, bound to a data model path where the renderer writes an array of FileReference objects ({fileId, fileName, fileSize, mimeType}).',
      ),
    action: ActionSchema.optional().describe(
      'Optional action dispatched each time value changes: after a successful upload and after the user removes a file.',
    ),
    checks: z.array(CheckRuleSchema).optional(),
  })
  .describe(
    'An input that lets the user pick or drop files, uploads them through the host application, and writes a file reference per file to the data model.',
  );

export const DEMO_CATALOG = new Catalog(
  FILE_UPLOAD_CATALOG_ID,
  [
    ...BASIC_COMPONENTS,
    {name: 'FileUpload', component: FileUploadComponent, schema: FileUploadSchema},
  ],
  BASIC_FUNCTIONS,
);
