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

import * as fs from 'fs';
import * as path from 'path';
import {Validator} from './validator';
import {GeneratedResult, ProtocolSchemas} from './types';

const schemaFiles = [
  '../../json/common_types.json',
  '../../catalogs/basic/catalog.json',
  '../../json/server_to_client.json',
];

function loadSchemas(): ProtocolSchemas {
  const schemas: ProtocolSchemas = {};
  for (const file of schemaFiles) {
    const schemaString = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    const schema = JSON.parse(schemaString);
    const key = file.replace('../../', '');
    schemas[key] = schema;
  }

  if (schemas['catalogs/basic/catalog.json']) {
    const catalogSchema = JSON.parse(JSON.stringify(schemas['catalogs/basic/catalog.json']));
    if (catalogSchema['$id']) {
      catalogSchema['$id'] = catalogSchema['$id'].replace(
        /catalogs\/basic\/catalog\.json$/,
        'catalog.json',
      );
    }
    schemas['catalog.json'] = catalogSchema;
  }

  return schemas;
}

async function runTests() {
  const schemas = loadSchemas();
  const validator = new Validator(schemas);

  const mockPrompt = {
    name: 'test_prompt',
    description: 'test description',
    promptText: 'test prompt',
  };

  const testCases: {
    name: string;
    messages: any[];
    expectedErrors: string[];
  }[] = [
    {
      name: 'Valid flow (create, update components, update data model, delete)',
      messages: [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf1',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello World',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'surf1',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello Updated',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'surf1',
            path: '/name',
            value: 'Alice',
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 'surf1',
          },
        },
      ],
      expectedErrors: [],
    },
    {
      name: 'Duplicate createSurface',
      messages: [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf2',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf2',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello 2',
              },
            ],
          },
        },
      ],
      expectedErrors: [
        "Duplicate createSurface message received for surface 'surf2' without prior deleteSurface.",
      ],
    },
    {
      name: 'updateComponents before createSurface',
      messages: [
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'surf3',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
      ],
      expectedErrors: [
        "updateComponents message received for surface 'surf3' before createSurface message.",
      ],
    },
    {
      name: 'updateDataModel before createSurface',
      messages: [
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'surf3_dm',
            path: '/name',
            value: 'Bob',
          },
        },
      ],
      expectedErrors: [
        "updateDataModel message received for surface 'surf3_dm' before createSurface message.",
      ],
    },
    {
      name: 'updateComponents after deleteSurface',
      messages: [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf4',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 'surf4',
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'surf4',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Updated Hello',
              },
            ],
          },
        },
      ],
      expectedErrors: [
        "updateComponents message received for inactive or deleted surface 'surf4'.",
      ],
    },
    {
      name: 'updateDataModel after deleteSurface',
      messages: [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf5',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 'surf5',
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'surf5',
            path: '/name',
            value: 'Bob',
          },
        },
      ],
      expectedErrors: ["updateDataModel message received for inactive or deleted surface 'surf5'."],
    },
    {
      name: 'deleteSurface twice',
      messages: [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'surf6',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Hello',
              },
            ],
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 'surf6',
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 'surf6',
          },
        },
      ],
      expectedErrors: [
        "deleteSurface message received for inactive or non-existent surface 'surf6'.",
      ],
    },
  ];

  let anyFailed = false;

  for (const tc of testCases) {
    const inputResult: GeneratedResult = {
      modelName: 'test-model',
      prompt: mockPrompt,
      runNumber: 1,
      components: tc.messages,
      latency: 100,
    };

    const validated = await validator.run([inputResult]);
    const validationErrors = validated[0].validationErrors;

    const matchedAll =
      tc.expectedErrors.every(expected => validationErrors.some(err => err.includes(expected))) &&
      validationErrors.length === tc.expectedErrors.length;

    if (matchedAll) {
      console.log(`PASS: ${tc.name}`);
    } else {
      console.error(`FAIL: ${tc.name}`);
      console.error(`  Expected errors containing: ${JSON.stringify(tc.expectedErrors)}`);
      console.error(`  Actual validation errors:   ${JSON.stringify(validationErrors)}`);
      anyFailed = true;
    }
  }

  if (anyFailed) {
    process.exit(1);
  } else {
    console.log('All validator unit tests passed!');
  }
}

runTests().catch(console.error);
