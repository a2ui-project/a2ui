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

import {ComponentNode, flattenComponentTree} from '../../../src/index.js';

describe('flattenComponentTree', () => {
  it('lists descendants before parents and allocates IDs parent first', () => {
    const tree: ComponentNode = {
      component: 'Column',
      children: [{component: 'Column', children: [{component: 'Text', text: 'a'}]}],
    };

    expect(flattenComponentTree(tree, {rootId: 'panel'})).toEqual([
      {component: 'Text', id: 'panel__text_1', text: 'a'},
      {component: 'Column', id: 'panel__column_1', children: ['panel__text_1']},
      {component: 'Column', id: 'panel', children: ['panel__column_1']},
    ]);
  });

  it('namespaces author IDs under the root and keeps the root ID bare', () => {
    const tree: ComponentNode = {
      component: 'Card',
      id: 'card',
      child: {component: 'Text', id: 'title', text: 'Hi'},
    };

    expect(flattenComponentTree(tree)).toEqual([
      {component: 'Text', id: 'card__title', text: 'Hi'},
      {component: 'Card', id: 'card', child: 'card__title'},
    ]);
  });

  it('gives the root the rootId instead of its own ID', () => {
    const tree: ComponentNode = {component: 'Card', id: 'card', child: {component: 'Text'}};

    expect(flattenComponentTree(tree, {rootId: 'instance'})).toEqual([
      {component: 'Text', id: 'instance__text_1'},
      {component: 'Card', id: 'instance', child: 'instance__text_1'},
    ]);
  });

  it('allocates the root ID under the "root" prefix when no ID is known', () => {
    expect(flattenComponentTree({component: 'Card', child: {component: 'Text'}})).toEqual([
      {component: 'Text', id: 'root__text_1'},
      {component: 'Card', id: 'root__card_1', child: 'root__text_1'},
    ]);
  });

  it('never allocates an ID the author set', () => {
    const tree: ComponentNode = {
      component: 'Row',
      children: [
        {component: 'Text', text: 'allocated'},
        {component: 'Text', id: 'text_1', text: 'authored'},
      ],
    };

    expect(flattenComponentTree(tree, {rootId: 'r'}).map(c => c.id)).toEqual([
      'r__text_2',
      'r__text_1',
      'r',
    ]);
  });

  it('keeps ID references as written', () => {
    const tree: ComponentNode = {
      component: 'Column',
      children: ['existing', {component: 'Text', text: 'new'}],
    };

    expect(flattenComponentTree(tree, {rootId: 'c'})).toEqual([
      {component: 'Text', id: 'c__text_1', text: 'new'},
      {component: 'Column', id: 'c', children: ['existing', 'c__text_1']},
    ]);
  });

  it('lists a node that appears twice once and references it from both places', () => {
    const shared: ComponentNode = {component: 'Text', text: 'shared'};
    const tree: ComponentNode = {component: 'Row', children: [shared, shared]};

    expect(flattenComponentTree(tree, {rootId: 'r'})).toEqual([
      {component: 'Text', id: 'r__text_1', text: 'shared'},
      {component: 'Row', id: 'r', children: ['r__text_1', 'r__text_1']},
    ]);
  });

  it('finds nodes inside plain objects and arrays of objects', () => {
    const tree: ComponentNode = {
      component: 'Tabs',
      tabs: [{title: 'One', child: {component: 'Text', text: '1'}}],
      list: {path: '/items', componentId: {component: 'Text', text: {'@path': 'name'}}},
    };

    expect(flattenComponentTree(tree, {rootId: 't'})).toEqual([
      {component: 'Text', id: 't__text_1', text: '1'},
      {component: 'Text', id: 't__text_2', text: {'@path': 'name'}},
      {
        component: 'Tabs',
        id: 't',
        tabs: [{title: 'One', child: 't__text_1'}],
        list: {path: '/items', componentId: 't__text_2'},
      },
    ]);
  });

  it('leaves out properties set to undefined and keeps null', () => {
    const tree: ComponentNode = {
      component: 'Card',
      weight: undefined,
      child: {component: 'Text', text: null, context: {a: undefined, b: 1}},
    };

    expect(flattenComponentTree(tree, {rootId: 'c'})).toEqual([
      {component: 'Text', id: 'c__text_1', text: null, context: {b: 1}},
      {component: 'Card', id: 'c', child: 'c__text_1'},
    ]);
  });

  it('flattens each root of an array in its own scope', () => {
    const roots: ComponentNode[] = [
      {component: 'Card', child: {component: 'Text'}},
      {component: 'Card', child: {component: 'Text'}},
    ];

    expect(flattenComponentTree(roots, {rootId: 'row'}).map(c => c.id)).toEqual([
      'row_0__text_1',
      'row_0',
      'row_1__text_1',
      'row_1',
    ]);
  });

  it('adds nothing for a root that is an ID reference', () => {
    expect(flattenComponentTree('existing')).toEqual([]);
  });

  it('does not change the tree it flattens', () => {
    const tree: ComponentNode = {component: 'Card', child: {component: 'Text', text: 'a'}};
    const before = structuredClone(tree);

    flattenComponentTree(tree, {rootId: 'c'});

    expect(tree).toEqual(before);
  });

  it('terminates on a tree that refers back to an ancestor', () => {
    const card: ComponentNode = {component: 'Card'};
    card['child'] = {component: 'Column', children: [card]};

    expect(flattenComponentTree(card, {rootId: 'c'})).toEqual([
      {component: 'Column', id: 'c__column_1', children: ['c']},
      {component: 'Card', id: 'c', child: 'c__column_1'},
    ]);
  });
});
