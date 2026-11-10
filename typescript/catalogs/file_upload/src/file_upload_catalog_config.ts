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
 * Host-level configuration of the A2UI File Upload catalog.
 *
 * A2UI payloads declare `FileUpload` components without naming storage buckets,
 * endpoints, or credentials. The host application supplies a {@link FileUploader}
 * once at startup via {@link configureFileUploadCatalog} to transfer selected
 * files through its own channel (cloud blob storage, internal API, MCP server,
 * or native mobile daemon) and return opaque `fileId` pointers.
 */

/** Default size ceiling (500 KB) for the inline data-URI fallback when no host uploader is set. */
export const DEFAULT_MAX_INLINE_SIZE = 500_000;

/** Context passed to {@link FileUploader.upload} for each file being uploaded. */
export interface FileUploadContext {
  /** Reports upload progress for this file as a percentage from `0` to `100`. */
  readonly onProgress: (percent: number) => void;
  /** Aborted when the element disconnects or a superseding upload cancels this batch. */
  readonly signal: AbortSignal;
  /** ID of the containing A2UI surface, when rendered inside one. */
  readonly surfaceId?: string;
  /** ID of the `FileUpload` component on the surface, when rendered inside one. */
  readonly componentId?: string;
}

/** Context passed to {@link FileUploader.remove} when the user removes an uploaded file. */
export interface FileRemoveContext {
  /** ID of the containing A2UI surface, when rendered inside one. */
  readonly surfaceId?: string;
  /** ID of the `FileUpload` component on the surface, when rendered inside one. */
  readonly componentId?: string;
}

/**
 * Structured upload result returned by {@link FileUploader.upload} when the host
 * also normalizes metadata (such as server-sniffed MIME types or renamed files).
 */
export interface FileUploadResult {
  /** Opaque URI identifying the uploaded file (never the file bytes). */
  readonly fileId: string;
  /** Overrides `file.name` when the host renames or normalizes the file. */
  readonly fileName?: string;
  /** Overrides `file.size` when the host transforms the file. */
  readonly fileSize?: number;
  /** Overrides `file.type` when the host detects or normalizes the MIME type. */
  readonly mimeType?: string;
}

/**
 * Host-provided transport that stores user-selected files out of band and
 * returns opaque `fileId` pointers for the A2UI surface data model.
 *
 * Structural interface: pass a plain `{upload, remove}` object, a service
 * instance, or a test double.
 */
export interface FileUploader {
  /**
   * Transfers `file` through the host's channel and resolves to either the
   * opaque `fileId` URI string (for example `'gdrive://1AbC'`, `'s3://bucket/key'`,
   * or an ephemeral `'https://...'` download URL) or a {@link FileUploadResult}.
   */
  upload(file: File, context: FileUploadContext): Promise<string | FileUploadResult>;

  /**
   * Optional cleanup hook invoked when the user removes a previously uploaded
   * file from the component.
   */
  remove?(fileId: string, context: FileRemoveContext): void | Promise<void>;
}

/** Host configuration for `@a2ui/catalog-file-upload`. */
export interface FileUploadCatalogConfig {
  /**
   * Host-provided uploader used by `FileUpload` components. When omitted, files
   * up to `maxInlineSize` fall back to `inline://<uuid>` pointers carrying a
   * data URI in `inlineData`.
   */
  readonly uploader?: FileUploader;

  /**
   * Maximum size in bytes of each file accepted by the inline fallback when no
   * `uploader` is configured. Defaults to {@link DEFAULT_MAX_INLINE_SIZE}
   * (`500_000` bytes). Set to `0` to disable inline fallback completely and
   * require a host `uploader`.
   */
  readonly maxInlineSize?: number;
}

let currentConfig: FileUploadCatalogConfig = {};

/**
 * Configures the File Upload catalog for this host. Unspecified fields keep
 * their current values, so the call can be repeated to update a single setting.
 */
export function configureFileUploadCatalog(config: FileUploadCatalogConfig): void {
  currentConfig = {...currentConfig, ...config};
}

/** Returns the active host configuration of the File Upload catalog. */
export function getFileUploadCatalogConfig(): FileUploadCatalogConfig {
  return currentConfig;
}

/** Clears the host configuration; tests call this in teardown. */
export function resetFileUploadCatalogConfig(): void {
  currentConfig = {};
}
