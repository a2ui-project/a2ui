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

/**
 * `@a2ui/catalog-file-upload`: the A2UI File Upload catalog with the
 * `FileUpload` universal component, configured once per host with
 * `configureFileUploadCatalog({uploader})`.
 */

export {FILE_UPLOAD_CATALOG_ID, fileUploadCatalog} from './catalog.js';
export {
  A2uiFileUpload,
  A2uiFileUploadElement,
  DEFAULT_FILE_UPLOAD_LABEL,
  DEFAULT_MAX_FILE_SIZE,
  FileReferenceSchema,
  FileUploadApi,
  INLINE_URI_PREFIX,
  type FileReference,
  type FileUploadProps,
} from './components/file_upload.js';
export {
  configureFileUploadCatalog,
  DEFAULT_MAX_INLINE_SIZE,
  type FileRemoveContext,
  type FileUploadCatalogConfig,
  type FileUploadContext,
  type FileUploader,
  type FileUploadResult,
} from './file_upload_catalog_config.js';
