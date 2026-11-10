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
import {afterEach, before, beforeEach, describe, it} from 'node:test';

import {
  basicCatalog,
  ComponentContext,
  MessageProcessor,
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import {FILE_UPLOAD_CATALOG_ID, fileUploadCatalog} from '../catalog.js';
import {
  configureFileUploadCatalog,
  type FileRemoveContext,
  type FileUploadContext,
  type FileUploader,
  resetFileUploadCatalogConfig,
} from '../file_upload_catalog_config.js';
import {resetTestDom} from '../testing/dom.js';
import {
  A2uiFileUpload,
  A2uiFileUploadElement,
  DEFAULT_FILE_UPLOAD_LABEL,
  type FileReference,
  formatFileSize,
  INLINE_URI_PREFIX,
  matchesAccept,
} from './file_upload.js';

interface MountedSurfaceUpload {
  readonly processor: MessageProcessor<WebComponentImplementation>;
  readonly element: A2uiFileUploadElement;
  readonly dispatched: Array<{name: string; context?: Record<string, unknown>}>;
  readonly nextAction: () => Promise<{name: string; context?: Record<string, unknown>}>;
  readonly getFilesInModel: () => unknown;
  readonly setFilesInModel: (val: unknown) => void;
  readonly dispose: () => void;
}

describe('matchesAccept and formatFileSize', () => {
  it('matches MIME types, wildcards, and case-insensitive extensions', () => {
    const pdf = new File(['x'], 'Report.PDF', {type: 'application/pdf'});
    const png = new File(['x'], 'photo.png', {type: 'image/png'});
    const csv = new File(['x'], 'data.CSV', {type: ''});

    assert.equal(matchesAccept(pdf, undefined), true);
    assert.equal(matchesAccept(pdf, '*/*'), true);
    assert.equal(matchesAccept(pdf, 'image/*, application/pdf'), true);
    assert.equal(matchesAccept(png, 'image/*, application/pdf'), true);
    assert.equal(matchesAccept(csv, '.csv, .xlsx'), true);
    assert.equal(matchesAccept(pdf, '.csv, image/*'), false);
  });

  it('formats byte counts cleanly across B, KB, and MB', () => {
    assert.equal(formatFileSize(0), '0 B');
    assert.equal(formatFileSize(512), '512 B');
    assert.equal(formatFileSize(1536), '1.5 KB');
    assert.equal(formatFileSize(20_480), '20 KB');
    assert.equal(formatFileSize(10_485_760), '10 MB');
  });
});

describe('A2uiFileUploadElement', () => {
  const disposers: Array<() => void> = [];

  async function mountSurfaceFileUpload(
    componentSpec: Record<string, unknown> = {},
    initialFiles: unknown = [],
  ): Promise<MountedSurfaceUpload> {
    const dispatched: Array<{name: string; context?: Record<string, unknown>}> = [];
    const actionWaiters: Array<
      (action: {name: string; context?: Record<string, unknown>}) => void
    > = [];
    const processor = new MessageProcessor<WebComponentImplementation>(
      [basicCatalog, fileUploadCatalog],
      action => {
        const typed = action as {name: string; context?: Record<string, unknown>};
        dispatched.push(typed);
        actionWaiters.shift()?.(typed);
      },
    );

    processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's1',
          value: {
            upload: {files: initialFiles},
          },
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'FileUpload',
              catalogId: FILE_UPLOAD_CATALOG_ID,
              value: {'@path': '/upload/files'},
              ...componentSpec,
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    const element = document.createElement('a2ui-file-upload') as A2uiFileUploadElement;
    element.context = new ComponentContext(surface, 'root', '/');
    document.body.appendChild(element);
    await element.updateComplete;

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      element.remove();
      surface.dispose();
    };
    disposers.push(dispose);

    return {
      processor,
      element,
      dispatched,
      nextAction: () =>
        new Promise<{name: string; context?: Record<string, unknown>}>(resolve => {
          actionWaiters.push(resolve);
        }),
      getFilesInModel: () => surface.dataModel.get('/upload/files'),
      setFilesInModel: val => surface.dataModel.set('/upload/files', val),
      dispose,
    };
  }

  before(() => {
    registerUniversalElement(A2uiFileUpload);
  });

  beforeEach(() => {
    resetTestDom();
    resetFileUploadCatalogConfig();
  });

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
    resetTestDom();
    resetFileUploadCatalogConfig();
  });

  it('renders the default prompt, hint, and accessible file input', async () => {
    const mounted = await mountSurfaceFileUpload({
      accessibility: {label: 'Receipt files'},
    });

    const prompt = mounted.element.querySelector('.a2ui-fileupload-prompt');
    const hint = mounted.element.querySelector('.a2ui-fileupload-hint');
    const input = mounted.element.querySelector('input[type="file"]') as HTMLInputElement;

    assert.equal(prompt?.textContent, DEFAULT_FILE_UPLOAD_LABEL);
    assert.equal(hint?.textContent, 'Max 10 MB');
    assert.equal(input.multiple, false);
    assert.equal(input.getAttribute('aria-label'), 'Receipt files');
  });

  it('delegates uploads to the host FileUploader (IoC), reports progress, and supports metadata overrides', async () => {
    const progressReports: number[] = [];
    let observedContext: FileUploadContext | undefined;

    configureFileUploadCatalog({
      uploader: {
        upload: async (file, ctx) => {
          observedContext = ctx;
          ctx.onProgress(40);
          progressReports.push(40);
          ctx.onProgress(90);
          progressReports.push(90);
          return {
            fileId: `vault://${file.name}`,
            mimeType: 'text/csv',
          };
        },
      },
    });

    const mounted = await mountSurfaceFileUpload({
      label: 'Upload CSV',
      accept: '.csv',
    });

    const rawFile = new File(['a,b\n1,2'], 'metrics.csv', {type: ''});
    await mounted.element.selectFiles([rawFile]);
    await mounted.element.updateComplete;

    assert.deepEqual(progressReports, [40, 90]);
    assert.equal(observedContext?.surfaceId, 's1');
    assert.equal(observedContext?.componentId, 'root');
    assert.equal(observedContext?.signal.aborted, false);

    assert.deepEqual(mounted.getFilesInModel(), [
      {
        fileId: 'vault://metrics.csv',
        fileName: 'metrics.csv',
        fileSize: 7,
        mimeType: 'text/csv',
      },
    ]);

    const items = mounted.element.querySelectorAll('.a2ui-fileupload-item');
    assert.equal(items.length, 1);
    assert.equal(items[0].querySelector('.a2ui-fileupload-item-name')?.textContent, 'metrics.csv');
    assert.equal(mounted.dispatched.length, 0);
  });

  it('lets a per-element .uploader override the module-level catalog uploader', async () => {
    configureFileUploadCatalog({
      uploader: {upload: async () => 'global://ignored'},
    });

    const mounted = await mountSurfaceFileUpload();
    mounted.element.uploader = {
      upload: async file => `element://${file.name}`,
    };

    await mounted.element.selectFiles([new File(['ok'], 'note.txt', {type: 'text/plain'})]);
    await mounted.element.updateComplete;

    assert.deepEqual(mounted.getFilesInModel(), [
      {
        fileId: 'element://note.txt',
        fileName: 'note.txt',
        fileSize: 2,
        mimeType: 'text/plain',
      },
    ]);
  });

  it('falls back to inline:// data URIs when no uploader is configured, and enforces maxInlineSize', async () => {
    configureFileUploadCatalog({maxInlineSize: 16});

    const mounted = await mountSurfaceFileUpload();
    await mounted.element.selectFiles([new File(['hello'], 'small.txt', {type: 'text/plain'})]);
    await mounted.element.updateComplete;

    const refs = mounted.getFilesInModel() as FileReference[];
    assert.equal(refs.length, 1);
    assert.equal(refs[0].fileId.startsWith(INLINE_URI_PREFIX), true);
    assert.equal(refs[0].inlineData, 'data:text/plain;base64,aGVsbG8=');

    // Exceeding maxInlineSize surfaces an inline alert and leaves the previous value intact.
    const tooLarge = new File(['0123456789abcdef_extra'], 'big.txt', {type: 'text/plain'});
    await mounted.element.selectFiles([tooLarge]);
    await mounted.element.updateComplete;

    const alert = mounted.element.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? '', /exceeds inline upload limit/);
    assert.equal((mounted.getFilesInModel() as FileReference[]).length, 1);
  });

  it('disables inline fallback completely (including 0-byte files) when maxInlineSize is 0', async () => {
    configureFileUploadCatalog({maxInlineSize: 0});
    const mounted = await mountSurfaceFileUpload();

    await mounted.element.selectFiles([new File([], 'empty.txt', {type: 'text/plain'})]);
    await mounted.element.updateComplete;

    const alert = mounted.element.querySelector('[role="alert"]');
    assert.equal(alert?.textContent, 'No host FileUploader is configured for FileUpload.');
    assert.deepEqual(mounted.getFilesInModel(), []);

    await mounted.element.selectFiles([new File(['a'], 'tiny.txt', {type: 'text/plain'})]);
    await mounted.element.updateComplete;
    assert.deepEqual(mounted.getFilesInModel(), []);
  });

  it('rejects disallowed accept types and oversized files without calling the uploader or dispatching action', async () => {
    let uploadCalls = 0;
    configureFileUploadCatalog({
      uploader: {
        upload: async () => {
          uploadCalls += 1;
          return 's3://bucket/x';
        },
      },
    });

    const mounted = await mountSurfaceFileUpload({
      accept: 'application/pdf',
      maxSize: 10,
      action: {event: {name: 'uploaded'}},
    });

    await mounted.element.selectFiles([new File(['hi'], 'notes.txt', {type: 'text/plain'})]);
    await mounted.element.updateComplete;
    assert.match(
      mounted.element.querySelector('[role="alert"]')?.textContent ?? '',
      /does not match accepted types/,
    );

    await mounted.element.selectFiles([
      new File(['0123456789012345'], 'huge.pdf', {type: 'application/pdf'}),
    ]);
    await mounted.element.updateComplete;
    assert.match(
      mounted.element.querySelector('[role="alert"]')?.textContent ?? '',
      /exceeds maximum size/,
    );

    assert.equal(uploadCalls, 0);
    assert.equal(mounted.dispatched.length, 0);
  });

  it('replaces on multiple: false (restoring prior file on error) and appends on multiple: true', async () => {
    let failNext = false;
    configureFileUploadCatalog({
      uploader: {
        upload: async file => {
          if (failNext) {
            throw new Error('Storage unavailable');
          }
          return `drive://${file.name}`;
        },
      },
    });

    const single = await mountSurfaceFileUpload({multiple: false});
    await single.element.selectFiles([
      new File(['1'], 'first.txt', {type: 'text/plain'}),
      new File(['2'], 'second.txt', {type: 'text/plain'}),
    ]);
    await single.element.selectFiles([new File(['3'], 'third.txt', {type: 'text/plain'})]);
    assert.deepEqual(
      (single.getFilesInModel() as FileReference[]).map(f => f.fileName),
      ['third.txt'],
    );

    // Failed replacement restores `third.txt` instead of leaving `value` empty.
    failNext = true;
    await single.element.selectFiles([new File(['4'], 'fourth.txt', {type: 'text/plain'})]);
    await single.element.updateComplete;
    assert.deepEqual(
      (single.getFilesInModel() as FileReference[]).map(f => f.fileName),
      ['third.txt'],
    );
    assert.equal(
      single.element.querySelector('[role="alert"]')?.textContent,
      'Storage unavailable',
    );
    single.dispose();

    failNext = false;
    const multi = await mountSurfaceFileUpload({multiple: true});
    await multi.element.selectFiles([new File(['1'], 'one.txt', {type: 'text/plain'})]);
    await multi.element.selectFiles([new File(['2'], 'two.txt', {type: 'text/plain'})]);
    assert.deepEqual(
      (multi.getFilesInModel() as FileReference[]).map(f => f.fileName),
      ['one.txt', 'two.txt'],
    );
  });

  it('handles drag-and-drop and removes files via uploader.remove, serializing concurrent removals and catching errors', async () => {
    const removedCalls: Array<{fileId: string; ctx: FileRemoveContext}> = [];
    let failRemove = false;
    let resolveFirstRemove: (() => void) | undefined;

    const uploader: FileUploader = {
      upload: async file => `s3://uploads/${file.name}`,
      remove: (fileId, ctx) => {
        if (failRemove) {
          return Promise.reject(new Error('Delete denied'));
        }
        removedCalls.push({fileId, ctx});
        if (resolveFirstRemove === undefined) {
          return new Promise<void>(resolve => {
            resolveFirstRemove = resolve;
          });
        }
        return undefined;
      },
    };
    configureFileUploadCatalog({uploader});

    const mounted = await mountSurfaceFileUpload({
      multiple: true,
      action: {
        event: {
          name: 'files_changed',
          context: {files: {'@path': '/upload/files'}},
        },
      },
    });

    const dropAction = mounted.nextAction();
    const dropzone = mounted.element.querySelector('.a2ui-fileupload-dropzone')!;
    const dropEvent = new Event('drop', {bubbles: true, cancelable: true});
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [
          new File(['a'], 'a.txt', {type: 'text/plain'}),
          new File(['b'], 'b.txt', {type: 'text/plain'}),
        ],
      },
    });
    dropzone.dispatchEvent(dropEvent);
    await dropAction;
    await mounted.element.updateComplete;

    assert.equal(mounted.dispatched.length, 1);
    assert.equal(mounted.element.querySelectorAll('.a2ui-fileupload-item').length, 2);

    // Failed remove surfaces an alert and keeps both files intact without dispatching `action`.
    failRemove = true;
    await mounted.element.removeFile(0);
    await mounted.element.updateComplete;
    assert.equal(mounted.element.querySelector('[role="alert"]')?.textContent, 'Delete denied');
    assert.equal((mounted.getFilesInModel() as FileReference[]).length, 2);
    assert.equal(mounted.dispatched.length, 1);

    // Concurrent remove clicks while `uploader.remove` is pending are ignored cleanly.
    failRemove = false;
    const removeAction = mounted.nextAction();
    const buttons = mounted.element.querySelectorAll<HTMLButtonElement>('.a2ui-fileupload-remove');
    buttons[0].click();
    await mounted.element.updateComplete;
    // Second remove attempt while first is in flight must no-op.
    await mounted.element.removeFile(1);

    resolveFirstRemove?.();
    await removeAction;
    await mounted.element.updateComplete;

    assert.deepEqual(removedCalls, [
      {fileId: 's3://uploads/a.txt', ctx: {surfaceId: 's1', componentId: 'root'}},
    ]);
    assert.equal(mounted.dispatched.length, 2);
    assert.deepEqual(
      (mounted.dispatched[1].context?.['files'] as FileReference[]).map(f => f.fileName),
      ['b.txt'],
    );
  });

  it('reflects external data model updates and renders Checkable validation errors', async () => {
    configureFileUploadCatalog({
      uploader: {upload: async file => `s3://uploads/${file.name}`},
    });

    const mounted = await mountSurfaceFileUpload({
      checks: [
        {
          condition: {'@call': 'required', args: {value: {'@path': '/upload/files'}}},
          message: 'Please attach a file.',
        },
      ],
    });

    const input = mounted.element.querySelector('input[type="file"]')!;
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(
      mounted.element.querySelector('.a2ui-error-message')?.textContent,
      'Please attach a file.',
    );

    mounted.setFilesInModel([
      {
        fileId: 's3://uploads/preloaded.pdf',
        fileName: 'preloaded.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
      },
    ]);
    await mounted.element.updateComplete;

    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(mounted.element.querySelector('.a2ui-error-message'), null);
    assert.equal(mounted.element.querySelectorAll('.a2ui-fileupload-item').length, 1);
  });

  it('aborts in-flight uploads when disconnected so late completions do not write to the model', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveUpload!: (id: string) => void;

    configureFileUploadCatalog({
      uploader: {
        upload: (_file, {signal}) => {
          capturedSignal = signal;
          return new Promise<string>(resolve => {
            resolveUpload = resolve;
          });
        },
      },
    });

    const mounted = await mountSurfaceFileUpload();
    const pending = mounted.element.selectFiles([
      new File(['slow'], 'slow.txt', {type: 'text/plain'}),
    ]);

    mounted.element.remove();
    assert.equal(capturedSignal?.aborted, true);

    resolveUpload('s3://uploads/slow.txt');
    await pending;
    assert.deepEqual(mounted.getFilesInModel(), []);
  });

  it('works standalone without an A2UI surface controller and emits a change CustomEvent', async () => {
    const el = document.createElement('a2ui-file-upload') as A2uiFileUploadElement;
    el.label = 'Attach log';
    el.uploader = {upload: async file => `mem://${file.name}`};
    document.body.appendChild(el);
    await el.updateComplete;

    const events: FileReference[][] = [];
    el.addEventListener('change', e => {
      events.push((e as CustomEvent<{files: FileReference[]}>).detail.files);
    });

    await el.selectFiles([new File(['log'], 'app.log', {type: 'text/plain'})]);
    await el.updateComplete;

    assert.equal(events.length, 1);
    assert.equal(events[0][0].fileId, 'mem://app.log');
    assert.equal(el.files.length, 1);

    el.remove();
  });
});
