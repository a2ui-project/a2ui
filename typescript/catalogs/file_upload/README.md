# A2UI File Upload catalog (`@a2ui/catalog-file-upload`)

The A2UI File Upload catalog lets an A2UI surface collect files from the user without putting raw file bytes into A2UI messages or LLM conversation history. It defines the `FileUpload` universal component (`<a2ui-file-upload>`), while handing off the actual upload transport to the host application through a `FileUploader` configured once at startup.

## Overview

A2UI payloads are declarative and environment-agnostic: an agent emits a `FileUpload` component bound to a data model path (`value`) without naming storage buckets, presigned endpoints, MCP servers, or credentials. This package provides:

- **Host-delegated upload (IoC)**: The host supplies one `FileUploader` (`{upload, remove}`) via `configureFileUploadCatalog({uploader})`. When the user picks or drops files, `<a2ui-file-upload>` hands each `File` (plus progress callback and `AbortSignal`) to the host and writes the returned `fileId` pointer and metadata (`FileReference`) to the surface data model.
- **Inline fallback for prototyping**: When no `uploader` is configured, files up to `maxInlineSize` (default `500_000` bytes) fall back to `inline://<uuid>` pointers with a data URI in `inlineData`. Hosts that require out-of-band storage can disable the fallback with `maxInlineSize: 0`.
- **Two-way data model binding & validation**: `value` syncs with the surface data model in both directions, works with standard `Checkable` validation rules (such as `required`), and optionally dispatches `action` whenever `value` changes.
- **Universal Web Component**: Built on `A2uiLitElement` from `@a2ui/web_core/v1_0`, so `fileUploadCatalog` works with any A2UI web renderer (`@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`) or `MessageProcessor`.

## Catalog specification

The canonical schema lives at [`catalogs/file_upload/catalog.json`](../../../catalogs/file_upload/catalog.json) and is bundled into this package at build time as `@a2ui/catalog-file-upload/catalog.json`. The catalog ID is `https://a2ui.org/specification/v1_0/catalogs/file_upload/catalog.json`, available as `FILE_UPLOAD_CATALOG_ID` and `fileUploadCatalog.id`.

## Installation

```bash
yarn add @a2ui/catalog-file-upload @a2ui/web_core lit
```

## Quick start

### Register the catalog and configure the host uploader

Register `fileUploadCatalog` alongside `basicCatalog`, then tell the catalog how your host stores files with `configureFileUploadCatalog`. `<a2ui-file-upload>` reads the configuration when an upload runs, so the order of the two calls does not matter as long as both happen before the user selects a file:

```typescript
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {
  configureFileUploadCatalog,
  fileUploadCatalog,
  type FileUploader,
} from '@a2ui/catalog-file-upload';

const uploader: FileUploader = {
  async upload(file, {onProgress, signal}) {
    // Transfer `file` through your host's storage channel (S3 presigned PUT,
    // Google Drive API, internal upload endpoint, MCP server, or OS daemon)
    // and return the opaque pointer URI.
    const response = await myStorageClient.upload(file, {onProgress, signal});
    return response.uri; // e.g. "s3://my-bucket/uploads/9f3c..."
  },
  async remove(fileId) {
    await myStorageClient.delete(fileId);
  },
};

const processor = new MessageProcessor([basicCatalog, fileUploadCatalog], action => {
  console.log('A2UI action dispatched:', action);
});

configureFileUploadCatalog({uploader});
```

`FileUploader` is structural: pass a plain `{upload, remove}` object, a service class instance, or a test double.

### Returning normalized metadata

`uploader.upload` may return either a `fileId` string (when `file.name`, `file.size`, and `file.type` from the browser are sufficient) or a `FileUploadResult` object when the host normalizes metadata (for example, server-detected MIME types when the browser reports an empty `file.type`):

```typescript
configureFileUploadCatalog({
  uploader: {
    async upload(file, {signal}) {
      const stored = await uploadToBackend(file, {signal});
      return {
        fileId: stored.uri,
        mimeType: stored.detectedMimeType,
      };
    },
  },
});
```

### Disabling the inline fallback

In production environments where inline data URIs must never be produced even if host initialization was skipped, set `maxInlineSize: 0`:

```typescript
configureFileUploadCatalog({
  uploader,
  maxInlineSize: 0,
});
```

### Per-element uploader override

For standalone `<a2ui-file-upload>` elements or hosts with per-surface storage scopes, assign `.uploader` directly on the element instance; it takes precedence over `configureFileUploadCatalog`:

```typescript
import {A2uiFileUpload, type A2uiFileUploadElement} from '@a2ui/catalog-file-upload';
import {registerUniversalElement} from '@a2ui/web_core/v1_0';

registerUniversalElement(A2uiFileUpload);

const el = document.createElement('a2ui-file-upload') as A2uiFileUploadElement;
el.label = 'Drop a CSV file';
el.accept = '.csv';
el.uploader = {
  upload: async file => `mem://${file.name}`,
};
```

## Using `FileUpload` in A2UI payloads

Surfaces created on the basic catalog select this catalog on the component with `"catalogId": "https://a2ui.org/specification/v1_0/catalogs/file_upload/catalog.json"`:

```json
{
  "id": "receipt_upload",
  "component": "FileUpload",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/file_upload/catalog.json",
  "label": "Drop your receipts here or click to upload",
  "accept": "image/*, application/pdf",
  "maxSize": 10485760,
  "multiple": true,
  "value": {"@path": "/expense/receipts"},
  "checks": [
    {
      "condition": {
        "@call": "required",
        "args": {"value": {"@path": "/expense/receipts"}}
      },
      "message": "Upload at least one receipt."
    }
  ]
}
```

See [`catalogs/file_upload/README.md`](../../../catalogs/file_upload/README.md) and [`catalogs/file_upload/examples/`](../../../catalogs/file_upload/examples/) for full payload examples covering both form submission via `Button` and immediate dispatch via `FileUpload.action`.

## Styling (`@cssprop`)

`<a2ui-file-upload>` exposes two-tier CSS custom properties that fall back to global `--a2ui-*` theme tokens:

| Custom property                      | Default                                                  | Description                                                             |
| :----------------------------------- | :------------------------------------------------------- | :---------------------------------------------------------------------- |
| `--a2ui-fileupload-width`            | `auto`                                                   | Outer width of the component.                                           |
| `--a2ui-fileupload-gap`              | `var(--a2ui-spacing-s, 0.5rem)`                          | Gap between the drop zone, file list, and error messages.               |
| `--a2ui-fileupload-padding`          | `var(--a2ui-spacing-l, 1.25rem)`                         | Internal padding of the drop zone.                                      |
| `--a2ui-fileupload-border`           | `1.5px dashed var(--a2ui-color-border, #cbd5e1)`         | Border of the drop zone.                                                |
| `--a2ui-fileupload-border-radius`    | `var(--a2ui-border-radius, 0.5rem)`                      | Corner radius of the drop zone.                                         |
| `--a2ui-fileupload-background`       | `var(--a2ui-color-surface, transparent)`                 | Background of the drop zone.                                            |
| `--a2ui-fileupload-background-hover` | `var(--a2ui-color-secondary-hover, rgba(0, 0, 0, 0.03))` | Hover / drag-over background of the drop zone.                          |
| `--a2ui-fileupload-color-accent`     | `var(--a2ui-color-primary, #1a73e8)`                     | Accent color for focus ring, active drag-over border, and progress bar. |
| `--a2ui-fileupload-color-text`       | `var(--a2ui-color-on-surface, inherit)`                  | Prompt text color.                                                      |
| `--a2ui-fileupload-color-hint`       | `var(--a2ui-text-caption-color, #64748b)`                | Hint and file size color.                                               |
| `--a2ui-fileupload-color-error`      | `var(--a2ui-color-error, #d93025)`                       | Error border and message color.                                         |
| `--a2ui-fileupload-item-background`  | `var(--a2ui-color-surface, rgba(0, 0, 0, 0.03))`         | Background of each uploaded file row.                                   |
