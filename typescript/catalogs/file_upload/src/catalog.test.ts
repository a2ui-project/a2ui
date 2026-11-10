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
  Catalog,
  ComponentContext,
  DataContext,
  isWebComponentImplementation,
  MessageProcessor,
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import documentSummaryExample from '../../../../catalogs/file_upload/examples/file-upload-document-summary.json' with {type: 'json'};
import expenseReportExample from '../../../../catalogs/file_upload/examples/file-upload-expense-report.json' with {type: 'json'};
import catalogJson from './catalog.json' with {type: 'json'};
import {FILE_UPLOAD_CATALOG_ID, fileUploadCatalog} from './catalog.js';
import {A2uiFileUpload, A2uiFileUploadElement, FileUploadApi} from './components/file_upload.js';
import {
  configureFileUploadCatalog,
  resetFileUploadCatalogConfig,
} from './file_upload_catalog_config.js';
import {resetTestDom} from './testing/dom.js';

type A2uiMessages = Parameters<MessageProcessor<WebComponentImplementation>['processMessages']>[0];

function parseExampleMessages(example: {readonly messages: readonly unknown[]}): A2uiMessages {
  return structuredClone(example.messages) as A2uiMessages;
}

describe('fileUploadCatalog', () => {
  const disposers: Array<() => void> = [];

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

  it('is identified by the $id of catalogs/file_upload/catalog.json', () => {
    assert.equal(fileUploadCatalog.id, FILE_UPLOAD_CATALOG_ID);
    assert.equal(fileUploadCatalog.id, catalogJson['$id']);
    assert.equal(fileUploadCatalog.protocolVersion, '1.0');
  });

  it('serializes byte-for-byte to catalogs/file_upload/catalog.json and round-trips Catalog.fromJson', () => {
    assert.deepEqual(fileUploadCatalog.toJson(), catalogJson);

    const loaded = Catalog.fromJson(catalogJson);
    assert.equal(loaded.id, FILE_UPLOAD_CATALOG_ID);
    assert.equal(loaded.protocolVersion, '1.0');
    assert.deepEqual(loaded.toJson(), catalogJson);
  });

  it('implements every component of the catalog schema with an a2ui- custom element', () => {
    assert.deepEqual(
      [...fileUploadCatalog.components.keys()],
      Object.keys(catalogJson['components']),
    );
    assert.equal(fileUploadCatalog.components.get('FileUpload'), A2uiFileUpload);
    assert.equal(fileUploadCatalog.functions.size, 0);

    for (const component of fileUploadCatalog.components.values()) {
      assert.equal(isWebComponentImplementation(component), true);
      assert.match(component.tagName, /^a2ui-[a-z-]+$/);
    }
  });

  it('validates FileUpload properties', () => {
    const parse = (props: unknown) => FileUploadApi.schema.safeParse(props).success;
    assert.equal(parse({value: {'@path': '/files'}}), true);
    assert.equal(
      parse({
        label: 'Drop receipt',
        accept: 'image/*, application/pdf',
        maxSize: 1024,
        multiple: true,
        value: {'@path': '/files'},
        action: {event: {name: 'uploaded', context: {files: {'@path': '/files'}}}},
      }),
      true,
    );
    assert.equal(parse({}), false);
    assert.equal(parse({value: {'@path': '/files'}, unknownProp: true}), false);
  });

  it('runs the expense-report example end to end alongside basicCatalog', async () => {
    const dispatched: unknown[] = [];
    const processor = new MessageProcessor<WebComponentImplementation>(
      [basicCatalog, fileUploadCatalog],
      action => {
        dispatched.push(action);
      },
    );

    configureFileUploadCatalog({
      uploader: {
        upload: async file => `gdrive://receipt-${file.name}`,
      },
    });

    processor.processMessages(parseExampleMessages(expenseReportExample));
    const surface = processor.model.getSurface('gallery-file-upload-expense-report')!;
    disposers.push(() => surface.dispose());
    assert.equal(surface.componentsModel.get('receipt_upload')?.type, 'FileUpload');

    const el = document.createElement('a2ui-file-upload') as A2uiFileUploadElement;
    el.context = new ComponentContext(surface, 'receipt_upload', '/');
    document.body.appendChild(el);
    await el.updateComplete;

    // Before upload, the `required` check fails because `/expense/receipts` is `[]`.
    assert.equal(el.controller.props.isValid, false);

    const receipt = new File(['%PDF-1.4'], 'hotel.pdf', {type: 'application/pdf'});
    await el.selectFiles([receipt]);
    await el.updateComplete;

    assert.equal(el.controller.props.isValid, true);
    assert.deepEqual(surface.dataModel.get('/expense/receipts'), [
      {
        fileId: 'gdrive://receipt-hotel.pdf',
        fileName: 'hotel.pdf',
        fileSize: 8,
        mimeType: 'application/pdf',
      },
    ]);

    surface.dataModel.set('/expense/note', 'Team offsite lodging');
    const submitAction = surface.componentsModel.get('submit_button')!.properties['action'];
    const resolvedAction = await new DataContext(surface, '/').resolveAction(
      submitAction as Parameters<DataContext['resolveAction']>[0],
    );
    await surface.dispatchAction(
      resolvedAction as Parameters<typeof surface.dispatchAction>[0],
      'submit_button',
    );

    assert.equal(dispatched.length, 1);
    const sent = dispatched[0] as {name: string; context: Record<string, unknown>};
    assert.equal(sent.name, 'submit_expense_report');
    assert.deepEqual(sent.context, {
      receipts: [
        {
          fileId: 'gdrive://receipt-hotel.pdf',
          fileName: 'hotel.pdf',
          fileSize: 8,
          mimeType: 'application/pdf',
        },
      ],
      note: 'Team offsite lodging',
    });
  });

  it('runs the document-summary example end to end and auto-dispatches on upload', async () => {
    const dispatched: unknown[] = [];
    const processor = new MessageProcessor<WebComponentImplementation>(
      [basicCatalog, fileUploadCatalog],
      action => {
        dispatched.push(action);
      },
    );

    configureFileUploadCatalog({
      uploader: {
        upload: async file => `s3://docs/${file.name}`,
      },
    });

    processor.processMessages(parseExampleMessages(documentSummaryExample));
    const surface = processor.model.getSurface('gallery-file-upload-document-summary')!;
    disposers.push(() => surface.dispose());

    const el = document.createElement('a2ui-file-upload') as A2uiFileUploadElement;
    el.context = new ComponentContext(surface, 'document_upload', '/');
    document.body.appendChild(el);
    await el.updateComplete;

    const doc = new File(['quarterly report'], 'q3.pdf', {type: 'application/pdf'});
    await el.selectFiles([doc]);
    await el.updateComplete;

    assert.equal(dispatched.length, 1);
    const sent = dispatched[0] as {
      name: string;
      userMessage?: string;
      context: Record<string, unknown>;
    };
    assert.equal(sent.name, 'summarize_document');
    assert.equal(sent.userMessage, 'Summarize the uploaded document.');
    assert.deepEqual(sent.context, {
      files: [
        {
          fileId: 's3://docs/q3.pdf',
          fileName: 'q3.pdf',
          fileSize: 16,
          mimeType: 'application/pdf',
        },
      ],
    });
  });
});
