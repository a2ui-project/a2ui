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

import {css, html, LitElement, nothing, type PropertyValues} from 'lit';
import {property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {z} from 'zod';

import {
  A2uiLitElement,
  ActionSchema,
  CheckRuleSchema,
  type ComponentApi,
  DataBindingSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
  spec,
  specDef,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import {
  DEFAULT_MAX_INLINE_SIZE,
  type FileUploader,
  type FileUploadResult,
  getFileUploadCatalogConfig,
} from '../file_upload_catalog_config.js';

/** Default prompt rendered inside the drop zone when `label` is omitted. */
export const DEFAULT_FILE_UPLOAD_LABEL = 'Drag and drop files or click to upload';

/** Default per-file size limit (10 MB) when `maxSize` is omitted. */
export const DEFAULT_MAX_FILE_SIZE = 10_485_760;

/** URI scheme prefix produced by the inline data-URI fallback. */
export const INLINE_URI_PREFIX = 'inline://';

const FALLBACK_MIME_TYPE = 'application/octet-stream';

/**
 * Zod schema for `$defs/FileReference` in `catalogs/file_upload/catalog.json`.
 * Keys are quoted to prevent property renaming under Closure-style minifiers.
 */
export const FileReferenceSchema = specDef(
  'FileReference',
  z
    .object({
      'fileId': z
        .string()
        .describe(
          'An opaque URI that identifies the uploaded file, returned by the host\'s upload handler (e.g. "gdrive://1AbC", "s3://bucket/key", or an ephemeral "https://" download URL). When the host has no upload handler, the renderer falls back to an "inline://<uuid>" pointer and puts the content in `inlineData`. The agent resolves the URI to the file content out of band; the pointer itself never carries the bytes.',
        ),
      'fileName': z.string().describe('The name of the file as selected by the user.'),
      'fileSize': z.number().int().describe('The size of the file in bytes.'),
      'mimeType': z.string().describe('The MIME type of the file, e.g. "application/pdf".'),
      'inlineData': z
        .string()
        .describe(
          'The file content as a data URI. Present only when `fileId` is an "inline://" pointer, i.e. when the host has no upload handler and the file is within the renderer\'s inline size limit. The host\'s transport should move it out of the action payload (for example into an A2A FilePart whose metadata carries the `fileId`) so conversation history is not bloated with base64 content.',
        )
        .optional(),
    })
    .strict()
    .describe(
      'A pointer to an uploaded file. The renderer writes one per uploaded file to the data model path bound to `FileUpload.value`.',
    ),
);

/** A pointer to an uploaded file stored at the data model path bound to `FileUpload.value`. */
export type FileReference = z.infer<typeof FileReferenceSchema>;

/**
 * Component API of `FileUpload` (`catalogs/file_upload/catalog.json`).
 * Keys are quoted to prevent property renaming under Closure-style minifiers.
 */
export const FileUploadApi = {
  name: 'FileUpload',
  schema: spec(
    z
      .object({
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe('A list of validation check rules to perform on the component.')
          .optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The prompt shown in the drop zone, e.g. "Drop a PDF here or click to upload". Defaults to a generic prompt chosen by the renderer.',
        ).optional(),
        'accept': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Comma-separated list of accepted MIME types or file extensions, e.g. "image/*, application/pdf" or ".csv, .xlsx". Defaults to accepting any file. This is a convenience filter for the file picker; the agent must still validate what it receives.',
        ).optional(),
        'maxSize': DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|Maximum size of each file in bytes. The renderer rejects larger files with an inline error and does not upload them. Defaults to a limit chosen by the renderer.',
        ).optional(),
        'multiple': z
          .boolean()
          .default(false)
          .describe(
            'Whether the user may upload more than one file. When true, newly uploaded files are appended to the current list; when false, picking a new file replaces the previous one.',
          )
          .optional(),
        'value': z
          .union([
            z.array(FileReferenceSchema),
            DataBindingSchema.describe('REF:#/$defs/DataBinding'),
          ])
          .describe(
            'The uploaded files, bound to a data model path (e.g. {"@path": "/upload/files"}) where the renderer writes an array of FileReference objects. The array is replaced after every upload and removal, and is empty until the first upload completes. Read it from a Button action context with a path to the same location, e.g. {"files": {"@path": "/upload/files"}}.',
          ),
        'action': ActionSchema.describe(
          'REF:#/$defs/Action|Optional action dispatched each time `value` changes: after a successful upload and after the user removes a file. Use it to notify the agent without a separate submit button, binding the files into the event context with a path to `value`. Uploads that fail do not dispatch the action.',
        ).optional(),
      })
      .describe(
        'An input that lets the user pick or drag and drop files. The renderer uploads each file through the host application and writes the resulting file references to the data model path bound to `value`. The action payload and the data model carry only a `fileId` pointer and metadata per file; the agent resolves the pointer to the file content out of band.',
      )
      .strict(),
    {mixins: ['Checkable'], required: ['value']},
  ),
} satisfies ComponentApi;

/** Properties of `FileUpload`, as declared in the catalog. */
export type FileUploadProps = z.infer<typeof FileUploadApi.schema>;

/** Formats a byte count into a human-readable label (`B`, `KB`, or `MB`). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1_048_576) {
    const kb = bytes / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  const mb = bytes / 1_048_576;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * Checks whether `file` satisfies a comma-separated `accept` filter (MIME types,
 * wildcard MIME prefixes such as `image/` + `*`, or `.ext` file extensions). An
 * empty or universal wildcard filter accepts every file.
 */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept || accept.trim() === '') {
    return true;
  }
  const tokens = accept
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
  if (tokens.length === 0 || tokens.includes('*/*') || tokens.includes('*')) {
    return true;
  }
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return tokens.some(token => {
    if (token.startsWith('.')) {
      return fileName.endsWith(token);
    }
    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1); // keeps trailing '/'
      return mimeType.startsWith(prefix);
    }
    return mimeType === token;
  });
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return !Array.isArray(val) && typeof val === 'object' && val !== null;
}

function parseFileReferences(raw: unknown): FileReference[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const refs: FileReference[] = [];
  for (const item of raw) {
    if (!isPlainRecord(item)) {
      continue;
    }
    const fileId = item['fileId'];
    const fileName = item['fileName'];
    const fileSize = item['fileSize'];
    const mimeType = item['mimeType'];
    const inlineData = item['inlineData'];
    if (
      typeof fileId === 'string' &&
      typeof fileName === 'string' &&
      typeof fileSize === 'number' &&
      typeof mimeType === 'string'
    ) {
      refs.push({
        'fileId': fileId,
        'fileName': fileName,
        'fileSize': fileSize,
        'mimeType': mimeType,
        ...(typeof inlineData === 'string' ? {'inlineData': inlineData} : {}),
      });
    }
  }
  return refs;
}

function encodeAsDataUri(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available in this environment'));
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, {once: true});
    reader.onload = () => {
      signal.removeEventListener('abort', onAbort);
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to encode file as data URI'));
      }
    };
    reader.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Failed to encode file as data URI'));
    };
    reader.readAsDataURL(file);
  });
}

function createInlineUri(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${INLINE_URI_PREFIX}${uuid}`;
}

function normalizeUploadResult(
  raw: string | FileUploadResult,
  file: File,
): Omit<FileReference, 'inlineData'> {
  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      throw new Error('Host FileUploader returned an empty fileId.');
    }
    return {
      'fileId': raw,
      'fileName': file.name,
      'fileSize': file.size,
      'mimeType': file.type || FALLBACK_MIME_TYPE,
    };
  }
  if (!isPlainRecord(raw) || typeof raw.fileId !== 'string' || raw.fileId.trim() === '') {
    throw new Error('Host FileUploader returned an empty fileId.');
  }
  return {
    'fileId': raw.fileId,
    'fileName': raw.fileName ?? file.name,
    'fileSize':
      typeof raw.fileSize === 'number' && Number.isFinite(raw.fileSize)
        ? Math.trunc(raw.fileSize)
        : file.size,
    'mimeType': raw.mimeType ?? (file.type || FALLBACK_MIME_TYPE),
  };
}

/**
 * Universal custom element implementing the `FileUpload` component of the A2UI
 * File Upload catalog.
 *
 * Delegates file storage to the host's {@link FileUploader} (configured globally
 * with `configureFileUploadCatalog({uploader})` or per-element via `.uploader`),
 * writes a {@link FileReference} per uploaded file to the bound `value` data
 * model path, and dispatches `action` when declared.
 *
 * @cssprop [--a2ui-fileupload-width=auto] - Outer width of the component.
 * @cssprop [--a2ui-fileupload-gap=var(--a2ui-spacing-s, 0.5rem)] - Vertical gap between the drop zone, file list, and messages.
 * @cssprop [--a2ui-fileupload-padding=var(--a2ui-spacing-l, 1.25rem)] - Internal padding of the drop zone.
 * @cssprop [--a2ui-fileupload-border=1.5px dashed var(--a2ui-color-border, #cbd5e1)] - Border of the drop zone.
 * @cssprop [--a2ui-fileupload-border-radius=var(--a2ui-border-radius, 0.5rem)] - Corner radius of the drop zone.
 * @cssprop [--a2ui-fileupload-background=var(--a2ui-color-surface, transparent)] - Background of the drop zone.
 * @cssprop [--a2ui-fileupload-background-hover=var(--a2ui-color-secondary-hover, rgba(0, 0, 0, 0.03))] - Background of the drop zone on hover or drag-over.
 * @cssprop [--a2ui-fileupload-color-accent=var(--a2ui-color-primary, #1a73e8)] - Accent color for focus, active drag-over border, and progress bar.
 * @cssprop [--a2ui-fileupload-color-text=var(--a2ui-color-on-surface, inherit)] - Primary prompt text color.
 * @cssprop [--a2ui-fileupload-color-hint=var(--a2ui-text-caption-color, #64748b)] - Secondary hint and file size color.
 * @cssprop [--a2ui-fileupload-color-error=var(--a2ui-color-error, #d93025)] - Error border and message color.
 * @cssprop [--a2ui-fileupload-item-background=var(--a2ui-color-surface, rgba(0, 0, 0, 0.03))] - Background of each uploaded file row.
 */
export class A2uiFileUploadElement extends A2uiLitElement<typeof FileUploadApi> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-file-upload';

  protected override readonly api = FileUploadApi;

  /** Per-element uploader override; falls back to `configureFileUploadCatalog`. */
  @property({attribute: false}) uploader?: FileUploader;

  /** Per-element inline fallback size ceiling; falls back to `configureFileUploadCatalog`. */
  @property({attribute: false}) maxInlineSize?: number;

  /** Prompt text for standalone use; `controller.props.label` takes precedence. */
  @property({attribute: false}) label?: string;

  /** Accepted file filter for standalone use; `controller.props.accept` takes precedence. */
  @property({attribute: false}) accept?: string;

  /** Maximum file size in bytes for standalone use; `controller.props.maxSize` takes precedence. */
  @property({attribute: false}) maxSize?: number;

  /** Multi-file toggle for standalone use; `controller.props.multiple` takes precedence. */
  @property({type: Boolean}) multiple = false;

  /** Standalone value when mounted without an A2UI surface controller. */
  @property({attribute: false}) value: FileReference[] = [];

  @state() private uploading = false;
  @state() private removing = false;
  @state() private progress = 0;
  @state() private dragOver = false;
  @state() private uploadError: string | null = null;

  private uploadAbortController?: AbortController;
  private preReplacementFiles: FileReference[] | null = null;

  /** @nocollapse */
  static override styles = css`
    :host {
      display: block;
      width: var(--a2ui-fileupload-width, auto);
      box-sizing: border-box;
    }

    .a2ui-fileupload {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-fileupload-gap, var(--a2ui-spacing-s, 0.5rem));
    }

    .a2ui-fileupload-dropzone {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      padding: var(--a2ui-fileupload-padding, var(--a2ui-spacing-l, 1.25rem));
      border: var(--a2ui-fileupload-border, 1.5px dashed var(--a2ui-color-border, #cbd5e1));
      border-radius: var(--a2ui-fileupload-border-radius, var(--a2ui-border-radius, 0.5rem));
      background: var(--a2ui-fileupload-background, var(--a2ui-color-surface, transparent));
      color: var(--a2ui-fileupload-color-text, var(--a2ui-color-on-surface, inherit));
      text-align: center;
      cursor: pointer;
      transition:
        background-color 120ms ease,
        border-color 120ms ease;
    }

    .a2ui-fileupload-dropzone:hover,
    .a2ui-fileupload-dropzone.a2ui-fileupload-dragover {
      background: var(
        --a2ui-fileupload-background-hover,
        var(--a2ui-color-secondary-hover, rgba(0, 0, 0, 0.03))
      );
      border-color: var(--a2ui-fileupload-color-accent, var(--a2ui-color-primary, #1a73e8));
    }

    .a2ui-fileupload-dropzone:focus-within {
      outline: 2px solid var(--a2ui-fileupload-color-accent, var(--a2ui-color-primary, #1a73e8));
      outline-offset: 2px;
    }

    .a2ui-fileupload-dropzone.a2ui-invalid {
      border-color: var(--a2ui-fileupload-color-error, var(--a2ui-color-error, #d93025));
    }

    .a2ui-fileupload-dropzone.a2ui-fileupload-uploading {
      cursor: progress;
    }

    .a2ui-fileupload-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .a2ui-fileupload-prompt {
      font-size: var(--a2ui-label-font-size, var(--a2ui-font-size-s, 0.9375rem));
      font-weight: var(--a2ui-label-font-weight, 500);
    }

    .a2ui-fileupload-hint {
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      color: var(--a2ui-fileupload-color-hint, var(--a2ui-text-caption-color, #64748b));
    }

    .a2ui-fileupload-progress {
      width: 100%;
      height: 4px;
      margin-top: var(--a2ui-spacing-xs, 0.25rem);
      border-radius: 999px;
      background: var(--a2ui-color-border, rgba(0, 0, 0, 0.12));
      overflow: hidden;
    }

    .a2ui-fileupload-progress-bar {
      height: 100%;
      background: var(--a2ui-fileupload-color-accent, var(--a2ui-color-primary, #1a73e8));
      transition: width 120ms ease;
    }

    .a2ui-fileupload-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
    }

    .a2ui-fileupload-item {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-s, 0.5rem);
      padding: var(--a2ui-spacing-xs, 0.375rem) var(--a2ui-spacing-s, 0.625rem);
      border: var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #e2e8f0);
      border-radius: var(--a2ui-border-radius, 0.375rem);
      background: var(
        --a2ui-fileupload-item-background,
        var(--a2ui-color-surface, rgba(0, 0, 0, 0.03))
      );
      font-size: var(--a2ui-font-size-s, 0.875rem);
    }

    .a2ui-fileupload-item-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .a2ui-fileupload-item-size {
      flex-shrink: 0;
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      color: var(--a2ui-fileupload-color-hint, var(--a2ui-text-caption-color, #64748b));
    }

    .a2ui-fileupload-remove {
      flex-shrink: 0;
      border: none;
      background: transparent;
      color: var(--a2ui-fileupload-color-hint, var(--a2ui-text-caption-color, #64748b));
      cursor: pointer;
      padding: 0 0.25rem;
      font-size: 1rem;
      line-height: 1;
      border-radius: 0.25rem;
    }

    .a2ui-fileupload-remove:hover:not(:disabled) {
      color: var(--a2ui-fileupload-color-error, var(--a2ui-color-error, #d93025));
    }

    .a2ui-fileupload-remove:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .a2ui-fileupload-error,
    .a2ui-error-message {
      color: var(--a2ui-fileupload-color-error, var(--a2ui-color-error, #d93025));
      font-size: var(--a2ui-font-size-xs, 0.75rem);
    }
  `;

  protected override accessibilityTarget(): Element | null {
    const inputId = `${this.domId}-input`;
    return this.renderRoot.querySelector(`[id=${JSON.stringify(inputId)}]`);
  }

  /**
   * Allows standalone `<a2ui-file-upload>` usage without an A2UI surface
   * controller, matching `A2uiVegaChartElement`.
   */
  protected override update(changedProperties: PropertyValues) {
    if (this.controller) {
      super.update(changedProperties);
    } else {
      (LitElement.prototype as unknown as {update(p: PropertyValues): void}).update.call(
        this,
        changedProperties,
      );
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.uploadAbortController?.abort();
    this.uploadAbortController = undefined;
    this.preReplacementFiles = null;
  }

  /** Current `FileReference` list read from the bound data model (or `.value` when standalone). */
  get files(): FileReference[] {
    if (this.controller) {
      return parseFileReferences(this.controller.props?.value);
    }
    return parseFileReferences(this.value);
  }

  private get resolvedLabel(): string {
    return this.controller?.props?.label ?? this.label ?? DEFAULT_FILE_UPLOAD_LABEL;
  }

  private get resolvedAccept(): string {
    return this.controller?.props?.accept ?? this.accept ?? '';
  }

  private get resolvedMaxSize(): number {
    const raw = this.controller?.props?.maxSize ?? this.maxSize;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? raw
      : DEFAULT_MAX_FILE_SIZE;
  }

  private get resolvedMultiple(): boolean {
    const raw = this.controller?.props?.multiple;
    return raw !== undefined ? raw === true : this.multiple;
  }

  private resolveUploader(): FileUploader | undefined {
    return this.uploader ?? getFileUploadCatalogConfig().uploader;
  }

  private resolveMaxInlineSize(): number {
    const raw = this.maxInlineSize ?? getFileUploadCatalogConfig().maxInlineSize;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? raw
      : DEFAULT_MAX_INLINE_SIZE;
  }

  private get surfaceId(): string | undefined {
    return this.context?.dataContext?.surface?.id;
  }

  private get componentId(): string | undefined {
    return this.context?.componentModel?.id;
  }

  /**
   * Selects and uploads `selectedFiles` through the active {@link FileUploader}
   * (or the inline fallback), updating the bound `value` and dispatching `action`.
   */
  async selectFiles(selectedFiles: readonly File[]): Promise<void> {
    if (selectedFiles.length === 0 || this.removing) {
      return;
    }

    const isMultiple = this.resolvedMultiple;
    const batch = isMultiple ? [...selectedFiles] : [selectedFiles[0]];
    const accept = this.resolvedAccept;
    const maxSize = this.resolvedMaxSize;

    for (const file of batch) {
      if (!matchesAccept(file, accept)) {
        this.uploadError = `File "${file.name}" does not match accepted types (${accept}).`;
        return;
      }
      if (file.size > maxSize) {
        this.uploadError = `File "${file.name}" (${formatFileSize(file.size)}) exceeds maximum size (${formatFileSize(maxSize)}).`;
        return;
      }
    }

    const uploader = this.resolveUploader();
    const maxInlineSize = this.resolveMaxInlineSize();
    if (!uploader) {
      if (maxInlineSize === 0) {
        this.uploadError = 'No host FileUploader is configured for FileUpload.';
        return;
      }
      for (const file of batch) {
        if (file.size > maxInlineSize) {
          this.uploadError = `File "${file.name}" (${formatFileSize(file.size)}) exceeds inline upload limit (${formatFileSize(maxInlineSize)}). Configure a host FileUploader for larger files.`;
          return;
        }
      }
    }

    this.uploadAbortController?.abort();
    const abortController = new AbortController();
    this.uploadAbortController = abortController;

    const priorFiles = isMultiple ? this.files : [];
    this.uploadError = null;
    this.uploading = true;
    this.progress = 0;

    if (!isMultiple) {
      this.preReplacementFiles ??= this.files;
      // Single-file mode replaces the previous value; clear first so validation
      // checks like `required` hold while the replacement is in flight.
      this.writeValue([]);
    }

    const fileProgress = new Array<number>(batch.length).fill(0);
    const updateOverallProgress = () => {
      const sum = fileProgress.reduce((acc, p) => acc + p, 0);
      this.progress = Math.round(sum / batch.length);
    };

    try {
      const uploaded = await Promise.all(
        batch.map(async (file, idx) => {
          const ref = await this.uploadSingleFile(file, uploader, abortController.signal, pct => {
            const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
            fileProgress[idx] = clamped;
            updateOverallProgress();
          });
          fileProgress[idx] = 100;
          updateOverallProgress();
          return ref;
        }),
      );

      if (abortController.signal.aborted) {
        return;
      }

      const nextFiles = [...priorFiles, ...uploaded];
      this.preReplacementFiles = null;
      this.uploading = false;
      this.progress = 100;
      await this.commitValueAndDispatch(nextFiles);
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      const restore = this.preReplacementFiles;
      this.preReplacementFiles = null;
      if (!isMultiple && restore && restore.length > 0) {
        this.writeValue(restore);
      }
      this.uploading = false;
      this.progress = 0;
      this.uploadError = err instanceof Error ? err.message : 'Upload failed.';
    }
  }

  /** Removes the uploaded file at `index`, notifies the host uploader, and updates `value`. */
  async removeFile(index: number): Promise<void> {
    if (this.uploading || this.removing) {
      return;
    }
    const current = this.files;
    if (index < 0 || index >= current.length) {
      return;
    }
    const nextFiles = [...current];
    const [removed] = nextFiles.splice(index, 1);
    this.uploadError = null;

    const uploader = this.resolveUploader();
    if (uploader?.remove && removed && !removed.fileId.startsWith(INLINE_URI_PREFIX)) {
      this.removing = true;
      try {
        await uploader.remove(removed.fileId, {
          surfaceId: this.surfaceId,
          componentId: this.componentId,
        });
      } catch (err) {
        this.uploadError = err instanceof Error ? err.message : 'Failed to remove file.';
        return;
      } finally {
        this.removing = false;
      }
    }

    await this.commitValueAndDispatch(nextFiles);
  }

  private async uploadSingleFile(
    file: File,
    uploader: FileUploader | undefined,
    signal: AbortSignal,
    onProgress: (percent: number) => void,
  ): Promise<FileReference> {
    if (uploader) {
      const raw = await uploader.upload(file, {
        onProgress,
        signal,
        surfaceId: this.surfaceId,
        componentId: this.componentId,
      });
      return normalizeUploadResult(raw, file);
    }

    const inlineData = await encodeAsDataUri(file, signal);
    return {
      'fileId': createInlineUri(),
      'fileName': file.name,
      'fileSize': file.size,
      'mimeType': file.type || FALLBACK_MIME_TYPE,
      'inlineData': inlineData,
    };
  }

  private writeValue(nextFiles: FileReference[]): void {
    if (this.controller) {
      this.controller.props?.setValue?.(nextFiles);
    } else {
      this.value = nextFiles;
    }
  }

  private async commitValueAndDispatch(nextFiles: FileReference[]): Promise<void> {
    this.writeValue(nextFiles);
    if (this.controller) {
      await this.controller.props?.action?.();
    } else {
      this.dispatchEvent(
        new CustomEvent<{files: FileReference[]}>('change', {
          detail: {files: nextFiles},
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private readonly handleFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];
    if (input) {
      // Clear the native input so picking the same file again still fires `change`.
      input.value = '';
    }
    void this.selectFiles(files);
  };

  private readonly handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.uploading && !this.removing) {
      this.dragOver = true;
    }
  };

  private readonly handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
  };

  private readonly handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
    if (this.uploading || this.removing) {
      return;
    }
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    void this.selectFiles(files);
  };

  private readonly handleRemoveClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement | null;
    const index = Number(button?.dataset['index']);
    if (Number.isInteger(index)) {
      void this.removeFile(index);
    }
  };

  override render() {
    const props = this.controller?.props;
    const isInvalid = props?.isValid === false;
    const isBusy = this.uploading || this.removing;
    const inputId = `${this.domId}-input`;
    const accept = this.resolvedAccept;
    const maxSize = this.resolvedMaxSize;
    const multiple = this.resolvedMultiple;
    const files = this.files;
    const acceptSummary = accept ? `${accept} · ` : '';
    const hint = `${acceptSummary}Max ${formatFileSize(maxSize)}`;

    return html`
      <div class="a2ui-fileupload">
        <label
          for=${inputId}
          class=${classMap({
            'a2ui-fileupload-dropzone': true,
            'a2ui-fileupload-dragover': this.dragOver,
            'a2ui-fileupload-uploading': isBusy,
            'a2ui-invalid': isInvalid,
          })}
          @dragover=${this.handleDragOver}
          @dragleave=${this.handleDragLeave}
          @drop=${this.handleDrop}
        >
          <input
            id=${inputId}
            class="a2ui-fileupload-input"
            type="file"
            accept=${accept || nothing}
            ?multiple=${multiple}
            ?disabled=${isBusy}
            @change=${this.handleFileChange}
          />
          <span class="a2ui-fileupload-prompt">${this.resolvedLabel}</span>
          <span class="a2ui-fileupload-hint">${hint}</span>
          ${this.uploading
            ? html`
                <div
                  class="a2ui-fileupload-progress"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow=${this.progress}
                >
                  <div class="a2ui-fileupload-progress-bar" style="width: ${this.progress}%"></div>
                </div>
              `
            : nothing}
        </label>
        ${this.uploadError !== null
          ? html`<div class="a2ui-fileupload-error" role="alert">${this.uploadError}</div>`
          : nothing}
        ${files.length > 0
          ? html`
              <ul class="a2ui-fileupload-list">
                ${files.map(
                  (file, index) => html`
                    <li class="a2ui-fileupload-item">
                      <span class="a2ui-fileupload-item-name">${file.fileName}</span>
                      <span class="a2ui-fileupload-item-size">
                        ${formatFileSize(file.fileSize)}
                      </span>
                      <button
                        type="button"
                        class="a2ui-fileupload-remove"
                        aria-label=${`Remove ${file.fileName}`}
                        data-index=${index}
                        ?disabled=${isBusy}
                        @click=${this.handleRemoveClick}
                      >
                        ×
                      </button>
                    </li>
                  `,
                )}
              </ul>
            `
          : nothing}
        ${this.renderValidationErrors()}
      </div>
    `;
  }
}

/** Registration entry of `FileUpload` for a `Catalog`. */
export const A2uiFileUpload: WebComponentImplementation<typeof FileUploadApi.schema> = {
  ...FileUploadApi,
  tagName: A2uiFileUploadElement.tagName,
  element: A2uiFileUploadElement,
};

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-file-upload': A2uiFileUploadElement;
  }
}
