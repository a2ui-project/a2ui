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

import {PayloadValidator, projectSubpathChange, splitSubpath} from './payload_validation.js';

const SCORE_SCHEMA = {
  type: 'object',
  properties: {score: {type: 'number'}, player: {type: 'string'}},
  required: ['score'],
  additionalProperties: false,
};

describe('PayloadValidator', () => {
  let validator: PayloadValidator;

  beforeEach(() => {
    validator = new PayloadValidator();
  });

  describe('validate', () => {
    it('returns no errors for a matching payload', () => {
      expect(validator.validate(SCORE_SCHEMA, {score: 1, player: 'ann'})).toEqual([]);
    });

    it('describes each violation with its path', () => {
      const errors = validator.validate(SCORE_SCHEMA, {score: 'high', extra: true});
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toMatch(/score|additional/);
    });

    it('fails closed on a schema that does not compile', () => {
      const errors = validator.validate({type: 'no-such-type'}, {});
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Invalid schema');
    });

    it('reuses compiled schemas across calls', () => {
      expect(validator.validate(SCORE_SCHEMA, {score: 1})).toEqual([]);
      expect(validator.validate({...SCORE_SCHEMA}, {score: 'x'}).length).toBeGreaterThan(0);
      expect(validator.validate(SCORE_SCHEMA, {score: 2})).toEqual([]);
    });
  });

  describe('checkAllowlist', () => {
    const allowlist = {
      submit: SCORE_SCHEMA,
      ping: null,
      anything: {},
    };

    it('allows a listed name with a matching payload', () => {
      expect(validator.checkAllowlist('submit', {score: 3}, allowlist)).toEqual({
        status: 'allowed',
      });
    });

    it('reports a listed name with a payload that fails its schema', () => {
      const decision = validator.checkAllowlist('submit', {player: 'ann'}, allowlist);
      expect(decision.status).toBe('invalid');
      if (decision.status === 'invalid') {
        expect(decision.errors.length).toBeGreaterThan(0);
      }
    });

    it('reports names that are not listed, including inherited object members', () => {
      expect(validator.checkAllowlist('reset', {}, allowlist)).toEqual({status: 'not-listed'});
      expect(validator.checkAllowlist('constructor', {}, allowlist)).toEqual({
        status: 'not-listed',
      });
      expect(validator.checkAllowlist('toString', {}, allowlist)).toEqual({status: 'not-listed'});
      expect(validator.checkAllowlist('submit', {score: 1}, undefined)).toEqual({
        status: 'not-listed',
      });
    });

    it('allows a listed name without a schema object, whatever the payload', () => {
      expect(validator.checkAllowlist('ping', 'anything', allowlist)).toEqual({status: 'allowed'});
      expect(validator.checkAllowlist('anything', {free: true}, allowlist)).toEqual({
        status: 'allowed',
      });
    });

    it('skips the schema when validation is disabled but still requires the name', () => {
      const options = {disableSchemaValidation: true};
      expect(validator.checkAllowlist('submit', {player: 'ann'}, allowlist, options)).toEqual({
        status: 'allowed',
      });
      expect(validator.checkAllowlist('reset', {}, allowlist, options)).toEqual({
        status: 'not-listed',
      });
    });
  });
});

describe('splitSubpath', () => {
  it('splits reference tokens and unescapes them', () => {
    expect(splitSubpath('/a/b~1c/d~0e')).toEqual(['a', 'b/c', 'd~e']);
    expect(splitSubpath('a/b')).toEqual(['a', 'b']);
    expect(splitSubpath('')).toEqual([]);
    expect(splitSubpath('/')).toEqual(['']);
  });
});

describe('projectSubpathChange', () => {
  it('returns the value itself for an empty subpath', () => {
    expect(projectSubpathChange({a: 1}, '', 5)).toEqual({projected: 5});
  });

  it('applies the change to a copy of the root', () => {
    const root = {score: 1, player: 'ann'};
    expect(projectSubpathChange(root, '/score', 2)).toEqual({projected: {score: 2, player: 'ann'}});
    expect(root).toEqual({score: 1, player: 'ann'});
  });

  it('creates missing intermediate objects and starts from an object when the root is not one', () => {
    expect(projectSubpathChange({a: 1}, '/b/c', true)).toEqual({projected: {a: 1, b: {c: true}}});
    expect(projectSubpathChange(undefined, 'x', 1)).toEqual({projected: {x: 1}});
    expect(projectSubpathChange('text', '/x', 1)).toEqual({projected: {x: 1}});
  });

  it('writes array items by index', () => {
    expect(projectSubpathChange({items: ['a', 'b']}, '/items/1', 'c')).toEqual({
      projected: {items: ['a', 'c']},
    });
  });

  it('refuses prototype pollution segments', () => {
    expect(projectSubpathChange({}, '/__proto__/polluted', true)).toBeUndefined();
    expect(projectSubpathChange({}, '/a/constructor', true)).toBeUndefined();
    expect(projectSubpathChange({}, 'prototype', true)).toBeUndefined();
    expect(Object.prototype).not.toEqual(jasmine.objectContaining({polluted: true}));
  });
});
