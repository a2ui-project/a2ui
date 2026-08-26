// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {MessageProcessor} from './message-processor.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {
  encodeAgentToRendererMessage,
  normalizeAgentPayloadForProto,
} from '../serialization/protobuf-converter.js';
import {AgentToRendererListWrapperType} from '../v1_0/proto/index.js';
import {MIME_TYPE_PROTO_BYTES} from '../serialization/format.js';

describe('Restaurant Finder Protobuf E2E Processing', () => {
  let catalog: Catalog<ComponentApi>;
  let processor: MessageProcessor<ComponentApi>;

  beforeEach(() => {
    catalog = new Catalog('basic', []);
    processor = new MessageProcessor<ComponentApi>([catalog], async () => {}, {
      version: 'v1.0',
    });
  });

  const sampleCreateSurface = {
    createSurface: {
      surfaceId: 'restaurant-surface',
      catalogId: 'basic',
      sendDataModel: true,
      theme: {
        primaryColor: '#FF0000',
        font: 'Roboto',
      },
    },
  };

  const sampleUpdateComponents = {
    updateComponents: {
      surfaceId: 'restaurant-surface',
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['title-heading', 'item-list'],
        },
        {
          id: 'title-heading',
          component: 'Text',
          variant: 'h1',
          text: {
            path: '/title',
          },
        },
        {
          id: 'item-list',
          component: 'List',
          direction: 'vertical',
          children: {
            componentId: 'item-card-template',
            path: '/items',
          },
        },
        {
          id: 'item-card-template',
          component: 'Card',
          child: 'card-layout',
        },
        {
          id: 'card-layout',
          component: 'Row',
          children: ['card-image', 'card-details'],
        },
        {
          id: 'card-image',
          component: 'Image',
          variant: 'mediumFeature',
          url: {
            path: 'imageUrl',
          },
        },
        {
          id: 'card-details',
          component: 'Column',
          children: ['template-name', 'template-book-button'],
        },
        {
          id: 'template-name',
          component: 'Text',
          variant: 'h3',
          text: {
            path: 'name',
          },
        },
        {
          id: 'template-book-button',
          component: 'Button',
          label: 'Book Now',
          action: {
            name: 'book_restaurant',
            context: {
              restaurantName: {path: 'name'},
            },
          },
        },
      ],
    },
  };

  const sampleUpdateDataModel = {
    updateDataModel: {
      surfaceId: 'restaurant-surface',
      path: '/',
      value: {
        title: 'Top Szechuan Restaurants',
        items: [
          {
            name: 'Grand Sichuan',
            rating: 4.8,
            imageUrl: 'https://images.example.com/grand-sichuan.jpg',
          },
          {
            name: 'Spicy Village',
            rating: 4.6,
            imageUrl: 'https://images.example.com/spicy-village.jpg',
          },
        ],
      },
    },
  };

  it('processes in-memory binary Protobuf messages for the restaurant finder UI', () => {
    // Encode messages in-memory
    const createBytes = encodeAgentToRendererMessage(sampleCreateSurface);
    const compsBytes = encodeAgentToRendererMessage(sampleUpdateComponents);
    const dataBytes = encodeAgentToRendererMessage(sampleUpdateDataModel);

    // Process binary byte streams
    processor.processMessages(createBytes);
    processor.processMessages(compsBytes);
    processor.processMessages(dataBytes);

    // Verify SurfaceModel
    const surface = processor.getSurface('restaurant-surface');
    assert.ok(surface, 'Surface should be registered');
    assert.strictEqual(surface.id, 'restaurant-surface');
    assert.strictEqual(surface.catalog.id, 'basic');

    // Verify ComponentsModel
    assert.strictEqual(surface.componentsModel.get('root')?.type, 'Column');
    assert.strictEqual(surface.componentsModel.get('title-heading')?.type, 'Text');
    assert.strictEqual(surface.componentsModel.get('item-list')?.type, 'List');
    assert.strictEqual(surface.componentsModel.get('item-card-template')?.type, 'Card');
    assert.strictEqual(surface.componentsModel.get('template-book-button')?.type, 'Button');

    // Verify DataModel
    const titleVal = surface.dataModel.get('/title');
    assert.strictEqual(titleVal, 'Top Szechuan Restaurants');

    const itemsVal = surface.dataModel.get('/items') as Array<{name: string; rating: number}>;
    assert.ok(Array.isArray(itemsVal));
    assert.strictEqual(itemsVal.length, 2);
    assert.strictEqual(itemsVal[0].name, 'Grand Sichuan');
    assert.strictEqual(itemsVal[1].name, 'Spicy Village');
  });

  it('processes an array of A2A FileParts containing base64 encoded Protobuf bytes', () => {
    const createBytes = encodeAgentToRendererMessage(sampleCreateSurface);
    const compsBytes = encodeAgentToRendererMessage(sampleUpdateComponents);
    const dataBytes = encodeAgentToRendererMessage(sampleUpdateDataModel);

    // Package into A2A FilePart payloads
    const parts = [
      {
        kind: 'file',
        file: {
          bytes: Buffer.from(createBytes).toString('base64'),
          mime_type: MIME_TYPE_PROTO_BYTES,
        },
        metadata: {
          mimeType: MIME_TYPE_PROTO_BYTES,
        },
      },
      {
        kind: 'file',
        file: {
          bytes: Buffer.from(compsBytes).toString('base64'),
          mime_type: MIME_TYPE_PROTO_BYTES,
        },
        metadata: {
          mimeType: MIME_TYPE_PROTO_BYTES,
        },
      },
      {
        kind: 'file',
        file: {
          bytes: Buffer.from(dataBytes).toString('base64'),
          mime_type: MIME_TYPE_PROTO_BYTES,
        },
        metadata: {
          mimeType: MIME_TYPE_PROTO_BYTES,
        },
      },
    ];

    // Process entire parts array in one call
    processor.processMessages(parts);

    const surface = processor.getSurface('restaurant-surface');
    assert.ok(surface, 'Surface should be created from FileParts array');
    assert.strictEqual(surface.componentsModel.get('root')?.type, 'Column');
    assert.strictEqual(surface.dataModel.get('/title'), 'Top Szechuan Restaurants');
  });

  it('processes multi-message AgentToRendererListWrapper binary envelope', () => {
    const wrapper = AgentToRendererListWrapperType.create({
      messages: {
        messages: [
          normalizeAgentPayloadForProto(sampleCreateSurface),
          normalizeAgentPayloadForProto(sampleUpdateComponents),
          normalizeAgentPayloadForProto(sampleUpdateDataModel),
        ],
      },
    });

    const binaryPayload = AgentToRendererListWrapperType.encode(wrapper).finish();

    processor.processMessages(binaryPayload);

    const surface = processor.getSurface('restaurant-surface');
    assert.ok(surface, 'Surface should be created from wrapper');
    assert.strictEqual(surface.componentsModel.get('root')?.type, 'Column');
    assert.strictEqual(surface.dataModel.get('/title'), 'Top Szechuan Restaurants');
  });
});
