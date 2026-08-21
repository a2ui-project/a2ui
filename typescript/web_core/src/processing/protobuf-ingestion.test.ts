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
import {encodeAgentToRendererMessage} from '../serialization/protobuf-converter.js';
import {MIME_TYPE_PROTO_BYTES} from '../serialization/format.js';

describe('MessageProcessor Protobuf Ingestion', () => {
  let catalog: Catalog<ComponentApi>;
  let processor: MessageProcessor<ComponentApi>;

  beforeEach(() => {
    catalog = new Catalog('basic', []);
    processor = new MessageProcessor<ComponentApi>([catalog], async () => {}, {version: 'v1.0'});
  });

  it('processes binary Protobuf Uint8Array messages for lifecycle operations', () => {
    // 1. Create surface
    const createBytes = encodeAgentToRendererMessage({
      createSurface: {
        surfaceId: 'proto-surface-1',
        catalogId: catalog.id,
        sendDataModel: true,
      },
    });
    processor.processMessages(createBytes);

    const surface = processor.getSurface('proto-surface-1');
    assert.ok(surface, 'Surface should be created');
    assert.strictEqual(surface.id, 'proto-surface-1');

    // 2. Update components
    const updateCompsBytes = encodeAgentToRendererMessage({
      updateComponents: {
        surfaceId: 'proto-surface-1',
        components: [
          {
            id: 'txt1',
            component: 'Text',
            text: 'Rendered from Proto',
          },
        ],
      },
    });
    processor.processMessages(updateCompsBytes);

    const comp = surface.componentsModel.get('txt1');
    assert.ok(comp, 'Component txt1 should exist');
    assert.strictEqual(comp.properties.text, 'Rendered from Proto');

    // 3. Update data model
    const updateDataBytes = encodeAgentToRendererMessage({
      updateDataModel: {
        surfaceId: 'proto-surface-1',
        path: '/user/status',
        value: 'active_proto',
      },
    });
    processor.processMessages(updateDataBytes);

    assert.strictEqual(surface.dataModel.get('/user/status'), 'active_proto');

    // 4. Delete surface
    const deleteBytes = encodeAgentToRendererMessage({
      deleteSurface: {
        surfaceId: 'proto-surface-1',
      },
    });
    processor.processMessages(deleteBytes);

    assert.strictEqual(processor.getSurface('proto-surface-1'), undefined);
  });

  it('processes binary Protobuf ArrayBuffer inputs', () => {
    const createBytes = encodeAgentToRendererMessage({
      createSurface: {
        surfaceId: 'proto-ab-surface',
        catalogId: catalog.id,
      },
    });
    const arrayBuffer = createBytes.buffer.slice(
      createBytes.byteOffset,
      createBytes.byteOffset + createBytes.byteLength,
    );

    processor.processMessages(arrayBuffer);

    const surface = processor.getSurface('proto-ab-surface');
    assert.ok(surface, 'Surface should be created from ArrayBuffer');
  });

  it('processes A2A FilePart with base64 encoded Protobuf bytes', () => {
    const createBytes = encodeAgentToRendererMessage({
      createSurface: {
        surfaceId: 'a2a-part-surface',
        catalogId: catalog.id,
      },
    });
    const base64Str = Buffer.from(createBytes).toString('base64');

    const a2aPart = {
      root: {
        kind: 'file',
        file: {
          bytes: base64Str,
          mime_type: MIME_TYPE_PROTO_BYTES,
        },
        metadata: {
          mimeType: MIME_TYPE_PROTO_BYTES,
        },
      },
    };

    processor.processMessages(a2aPart);

    const surface = processor.getSurface('a2a-part-surface');
    assert.ok(surface, 'Surface should be created from A2A FilePart');
  });
});
