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

import {describe, expect, it} from 'vitest';

import {
  A2uiCatalogError,
  A2uiRequestProcessor,
  A2uiValidationError,
  DirectJsonFormatFactory,
  StreamedAnswer,
} from '../../../src/index.js';
import {MessageProcessor} from '../../../src/internal/web-core.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const OPEN = '<a2ui-json>';
const CLOSE = '</a2ui-json>';
const BASIC = loadBasicCatalog('1.0');

function newAnswer(): StreamedAnswer {
  const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());
  return new StreamedAnswer(processor, {renderer: new MessageProcessor([BASIC as never])});
}

function create(surfaceId: string): string {
  return JSON.stringify({version: '1.0', createSurface: {surfaceId, catalogId: BASIC.id}});
}

function root(surfaceId: string, component: Record<string, unknown>): string {
  return JSON.stringify({
    version: '1.0',
    updateComponents: {surfaceId, components: [{id: 'root', ...component}]},
  });
}

function surfaceBlock(surfaceId: string): string {
  return `${OPEN}[${create(surfaceId)}, ${root(surfaceId, {component: 'Text', text: 'Hi'})}]${CLOSE}`;
}

/** The parts of an answer, with each surface by its id and each error by its class. */
function describeParts(answer: StreamedAnswer): unknown[] {
  return answer.parts.map(part => {
    if (part.type === 'surface') return {surface: part.surface.id};
    if (part.type === 'error') return {error: part.error.constructor.name};
    return part.text;
  });
}

describe('StreamedAnswer', () => {
  it('keeps the text and surfaces in the order the model wrote them', () => {
    const answer = newAnswer();

    for (const chunk of ['Here ', 'it is: ', surfaceBlock('a'), ' and ', surfaceBlock('b')]) {
      answer.feed(chunk);
    }
    answer.feed(' Done.');
    answer.close();

    expect(describeParts(answer)).toEqual([
      'Here it is:',
      {surface: 'a'},
      'and',
      {surface: 'b'},
      'Done.',
    ]);
  });

  it("puts each surface in the renderer's model", () => {
    const renderer = new MessageProcessor([BASIC as never]);
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());
    const answer = new StreamedAnswer(processor, {renderer});

    answer.feed(surfaceBlock('a'));

    const part = answer.parts[0];
    expect(part.type).toBe('surface');
    expect(part.type === 'surface' && part.surface).toBe(renderer.model.getSurface('a'));
    expect(answer.renderer).toBe(renderer);
  });

  it('shows a rejected block as an error and goes on after it', () => {
    const answer = newAnswer();
    const bad = `${OPEN}[${create('bad')}, ${root('bad', {component: 'Bogus'})}]${CLOSE}`;

    answer.feed(`Before ${bad} after ${surfaceBlock('good')}`);
    answer.close();

    // The block arrived whole, so none of it was emitted.
    expect(describeParts(answer)).toEqual([
      'Before',
      {error: A2uiValidationError.name},
      'after',
      {surface: 'good'},
    ]);
  });

  it('keeps a surface that a rejected block created before it was rejected', () => {
    const answer = newAnswer();

    answer.feed(`${OPEN}[${create('a')}, `);
    answer.feed(`${root('a', {component: 'Bogus'})}]${CLOSE} after`);

    expect(describeParts(answer)).toEqual([
      {surface: 'a'},
      {error: A2uiValidationError.name},
      'after',
    ]);
  });

  it('adds an error for a block still open when the answer ends', () => {
    const answer = newAnswer();

    answer.feed(`Text ${OPEN}[`);
    answer.close();

    expect(describeParts(answer)).toEqual(['Text', {error: 'ParseError'}]);
  });

  it('drops a surface the answer deletes', () => {
    const answer = newAnswer();
    const remove = JSON.stringify({version: '1.0', deleteSurface: {surfaceId: 'a'}});

    answer.feed(`${surfaceBlock('a')} ${surfaceBlock('b')} ${OPEN}${remove}${CLOSE}`);

    expect(describeParts(answer)).toEqual([{surface: 'b'}]);
  });

  it('replaces its list of parts when they change, and only then', () => {
    const answer = newAnswer();
    answer.feed('Hello');
    const before = answer.parts;

    answer.feed(' <a2ui');
    expect(answer.parts).toBe(before);
    answer.feed('-json>');
    answer.feed(`[${create('a')}]`);

    expect(answer.parts).not.toBe(before);
    expect(before).toEqual([{type: 'text', text: 'Hello'}]);
  });

  it('says whether it ends inside a block', () => {
    const answer = newAnswer();

    answer.feed(`Text ${OPEN}[`);
    expect(answer.isInBlock).toBe(true);
    answer.feed(`]${CLOSE}`);
    expect(answer.isInBlock).toBe(false);
  });

  it("rejects a renderer whose catalogs are not the processor's", () => {
    const processor = new A2uiRequestProcessor([BASIC], undefined, new DirectJsonFormatFactory());
    const renderer = new MessageProcessor([loadBasicCatalog('v0.9') as never]);

    expect(() => new StreamedAnswer(processor, {renderer})).toThrow(A2uiCatalogError);
  });
});
