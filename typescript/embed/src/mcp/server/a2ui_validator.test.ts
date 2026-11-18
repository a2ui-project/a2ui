/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {A2uiValidator} from './a2ui_validator.js';
import authoredBasicCatalog from '../../../../../catalogs/basic/v1/catalog.json' with {type: 'json'};

const BASIC = basicCatalog.id;
const OTHER = 'example.com:other';

/** A catalog schema with a single `Badge` component, in the shape the build writes. */
const OTHER_CATALOG = {
  catalogId: OTHER,
  components: {
    Badge: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        component: {const: 'Badge'},
        label: {type: 'string'},
      },
      required: ['id', 'component', 'label'],
    },
  },
};

function basicValidator() {
  return new A2uiValidator({
    contractVersion: '1.0',
    catalogs: {[BASIC]: basicCatalog.validationSchema},
  });
}

function createSurface(components: unknown[], catalogId: string | undefined = BASIC) {
  return {version: '1.0', createSurface: {surfaceId: 'main', catalogId, components}};
}

function updateComponents(surfaceId: string, components: unknown[]) {
  return {version: '1.0', updateComponents: {surfaceId, components}};
}

const TEXT = {id: 'title', component: 'Text', text: 'Revenue'};

describe('A2uiValidator', () => {
  it('accepts valid messages', () => {
    const result = basicValidator().validate([
      createSurface([
        {id: 'root', component: 'Column', children: ['title', 'value']},
        TEXT,
        {id: 'value', component: 'Text', text: {'@path': '/revenue'}, variant: 'caption'},
      ]),
      {version: '1.0', updateDataModel: {surfaceId: 'main', value: {revenue: '$1M'}}},
      {version: '1.0', deleteSurface: {surfaceId: 'main'}},
    ]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('names the component, its type and the property of an invalid component', () => {
    const result = basicValidator().validate([
      createSurface([{id: 'kpi_value', component: 'Text', text: '42', variant: 'huge'}]),
    ]);
    assert.deepEqual(result, {
      ok: false,
      errors: [
        {
          messageIndex: 0,
          surfaceId: 'main',
          componentId: 'kpi_value',
          component: 'Text',
          property: 'variant',
          message:
            'Component "kpi_value" (Text): property "variant" must be one of "caption", "body"',
        },
      ],
    });
  });

  it('reports a missing required property', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: 't', component: 'Text'}]),
    ]).errors;
    assert.equal(error.message, 'Component "t" (Text): property "text" is required');
  });

  it('validates function calls against the catalog functions', () => {
    const [error] = basicValidator().validate([
      createSurface([
        {id: 't', component: 'Text', text: {'@call': 'formatString', args: {value: 3}}},
      ]),
    ]).errors;
    assert.equal(error.property, 'text.args.value');
  });

  it('rejects a component type the catalog does not define', () => {
    const [error] = basicValidator().validate([
      createSurface([{id: 'c', component: 'Chart'}]),
    ]).errors;
    assert.equal(
      error.message,
      `Component "c" (Chart): catalog "${BASIC}" has no component named "Chart".`,
    );
  });

  it('rejects a surface whose catalog the app does not include', () => {
    const [error] = basicValidator().validate([
      createSurface([TEXT], 'example.com:missing'),
    ]).errors;
    assert.equal(
      error.message,
      `Surface "main" uses catalog "example.com:missing", which the app does not include. The app includes: "${BASIC}".`,
    );
  });

  it('rejects a component whose @catalogId the app does not include', () => {
    const [error] = basicValidator().validate([
      createSurface([{...TEXT, '@catalogId': 'example.com:missing'}]),
    ]).errors;
    assert.match(error.message, /catalog "example.com:missing" is not included in the app/);
  });

  it('rejects a message that is not a server-to-client message', () => {
    const result = basicValidator().validate([{version: '1.0', hello: {}}, 'text']);
    assert.deepEqual(
      result.errors.map(error => error.message),
      [
        'Message 0 is not an A2UI v1.0 server-to-client message: it must have one of "createSurface", "updateComponents", "updateDataModel", "deleteSurface", "callRendererFunction", "agentFunctionResponse".',
        'Message 1 must be an object.',
      ],
    );
  });

  it('rejects an invalid envelope', () => {
    const result = basicValidator().validate([
      {version: '0.9', createSurface: {catalogId: BASIC, extra: true}},
    ]);
    assert.deepEqual(
      result.errors.map(error => error.message),
      [
        'Message 0 (createSurface): property "version" must be "1.0"',
        'Message 0 (createSurface): property "createSurface.surfaceId" is required',
        'Message 0 (createSurface): property "createSurface.extra" is not allowed',
      ],
    );
  });

  it('rejects messages that are not an array', () => {
    assert.equal(basicValidator().validate({}).ok, false);
  });

  it('validates updates against the catalog of a surface created in the same list', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    const result = validator.validate([
      createSurface([{id: 'root', component: 'Badge', label: 'New'}], OTHER),
      updateComponents('main', [{id: 'root', component: 'Badge', label: 1}]),
    ]);
    assert.deepEqual(
      result.errors.map(error => error.message),
      ['Component "root" (Badge): property "label" must be a string'],
    );
  });

  it('validates updates against the catalog of a surface created in an earlier call', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    const create = [createSurface([{id: 'root', component: 'Badge', label: 'New'}], OTHER)];
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.match(
      validator.validate(update).errors[0].message,
      /the catalog of surface "main" is unknown/,
    );
    validator.remember(create);
    assert.deepEqual(validator.validate(update), {ok: true, errors: []});
  });

  it('forgets the catalog of a deleted surface', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    validator.remember([createSurface([], OTHER)]);
    validator.remember([{version: '1.0', deleteSurface: {surfaceId: 'main'}}]);
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.equal(validator.validate(update).ok, false);
  });

  it('falls back to the only catalog for a surface it does not know', () => {
    const result = basicValidator().validate([updateComponents('unknown', [TEXT])]);
    assert.deepEqual(result, {ok: true, errors: []});
  });

  it('does not remember surfaces while validating', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: basicCatalog.validationSchema, [OTHER]: OTHER_CATALOG},
    });
    validator.validate([createSurface([], OTHER)]);
    const update = [updateComponents('main', [{id: 'root', component: 'Badge', label: 'Old'}])];
    assert.equal(validator.validate(update).ok, false);
  });

  it('resolves references to the specification in an authored catalog schema', () => {
    const validator = new A2uiValidator({
      contractVersion: '1.0',
      catalogs: {[BASIC]: authoredBasicCatalog},
    });
    assert.equal(validator.validate([createSurface([TEXT])]).ok, true);
    const [error] = validator.validate([
      createSurface([{id: 't', component: 'Text', text: 4}]),
    ]).errors;
    assert.equal(
      error.message,
      'Component "t" (Text): property "text" must be a string or an object',
    );
  });

  it('rejects a catalog schema without components', () => {
    assert.throws(
      () => new A2uiValidator({contractVersion: '1.0', catalogs: {[OTHER]: {}}}),
      /The schema of catalog "example.com:other" has no "components" object/,
    );
  });

  it('rejects a catalog schema with an unresolvable reference', () => {
    const catalog = {components: {Badge: {$ref: '#/$defs/Missing'}}};
    assert.throws(
      () => new A2uiValidator({contractVersion: '1.0', catalogs: {[OTHER]: catalog}}),
      /The schema of catalog "example.com:other" is invalid/,
    );
  });
});
