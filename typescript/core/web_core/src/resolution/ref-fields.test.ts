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

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import {V08_CHILD_REF_OPTIONS} from '../v0_8/standard_defs.js';
import {extractRefFields} from './ref-fields.js';

const COMMON = 'common_types.json';
const CID = {$ref: `${COMMON}#/$defs/ComponentId`};
const CHILD = {$ref: `${COMMON}#/$defs/Child`};
const LIST = {$ref: `${COMMON}#/$defs/ChildList`};
const DYN_STRING = {$ref: `${COMMON}#/$defs/DynamicString`};
const ACTION = {$ref: `${COMMON}#/$defs/Action`};
const STRING = {type: 'string'};
const NUMBER = {type: 'number'};

const docOf = (root: JsonSchema): SchemaDoc => ({
  root,
  defs: {[COMMON]: V10CommonTypes as JsonSchema},
});
const refs = (root: JsonSchema) => extractRefFields(root, docOf(root));

const obj = (properties: Record<string, JsonSchema>, extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  ...extra,
});
const arr = (items: JsonSchema) => ({type: 'array', items});
const record = (value: JsonSchema) => ({type: 'object', additionalProperties: value});
const allOf = (...parts: JsonSchema[]) => ({allOf: parts});
const anyOf = (...parts: JsonSchema[]) => ({anyOf: parts});

describe('extractRefFields', () => {
  it('extracts explicit ComponentId, Child, ChildList, and REF pointers on any field name', () => {
    const schema = obj({
      header: CID,
      footer: anyOf({...CHILD, description: 'Footer child.'}, {type: 'null'}),
      items: {...LIST, description: 'Items list.'},
      cards: arr(CID),
      handSingle: {type: 'string', description: 'REF:#/$defs/Child|Hand-authored child'},
      handList: {description: 'REF:common_types.json#/$defs/ChildList|Hand-authored list'},
      tabs: arr(obj({title: STRING, panel: CID})),
    });

    const r = refs(schema);
    assert.deepStrictEqual(r.get('header'), {kind: 'single'});
    assert.deepStrictEqual(r.get('footer'), {kind: 'single'});
    assert.deepStrictEqual(r.get('items'), {kind: 'list'});
    assert.deepStrictEqual(r.get('cards'), {kind: 'list'});
    assert.deepStrictEqual(r.get('handSingle'), {kind: 'single'});
    assert.deepStrictEqual(r.get('handList'), {kind: 'list'});
    assert.deepStrictEqual(r.get('tabs'), {kind: 'nested', keys: new Set(['panel'])});
  });

  it('follows $ref chains, defaults, nullable wrappers, and allOf stages safely', () => {
    const schema = {
      $defs: {Slot: CID},
      ...obj({
        slot: anyOf({$ref: '#/$defs/Slot'}, {type: 'null'}),
        list: {...LIST, default: []},
        pipedSingle: allOf(CID, STRING),
        pipedFromAny: allOf({}, CID),
        incompatiblePipeIn: allOf(NUMBER, CID),
        incompatiblePipeOut: allOf(CID, NUMBER),
      }),
    };

    const r = refs(schema);
    assert.deepStrictEqual(r.get('slot'), {kind: 'single'});
    assert.deepStrictEqual(r.get('list'), {kind: 'list'});
    assert.deepStrictEqual(r.get('pipedSingle'), {kind: 'single'});
    assert.deepStrictEqual(r.get('pipedFromAny'), {kind: 'single'});
    assert.strictEqual(r.has('incompatiblePipeIn'), false);
    assert.strictEqual(r.has('incompatiblePipeOut'), false);
  });

  it('terminates cleanly on self-referential $refs without misclassifying inline object trees', () => {
    const tree = {
      $defs: {Tree: obj({label: STRING, children: arr({$ref: '#/$defs/Tree'})})},
      $ref: '#/$defs/Tree',
    };
    assert.strictEqual(refs(tree).size, 0);

    const pathological = {$defs: {P: {$ref: '#/$defs/P'}}, $ref: '#/$defs/P'};
    assert.strictEqual(refs(pathological).size, 0);

    const recursiveArray = {
      $defs: {R: arr({$ref: '#/$defs/R'})},
      ...obj({children: {$ref: '#/$defs/R'}}),
    };
    assert.strictEqual(refs(recursiveArray).size, 0);

    const recursiveIncompatibleUnion = {
      $defs: {U: anyOf(NUMBER, {$ref: '#/$defs/U'})},
      ...obj({child: {$ref: '#/$defs/U'}}),
    };
    assert.strictEqual(refs(recursiveIncompatibleUnion).size, 0);

    const recursiveStringUnion = {
      $defs: {U: anyOf({$ref: '#/$defs/U'}, STRING)},
      ...obj({child: {$ref: '#/$defs/U'}}),
    };
    assert.deepStrictEqual(refs(recursiveStringUnion).get('child'), {kind: 'single'});
  });

  it('extracts child and children fallbacks for open records and unconstrained schemas', () => {
    for (const schema of [record({}), record(true), {}, true]) {
      const r = refs(schema);
      assert.deepStrictEqual(r.get('child'), {kind: 'single'});
      assert.deepStrictEqual(r.get('children'), {kind: 'list'});
      assert.strictEqual(r.size, 2);
    }

    const stringRecordRefs = refs(record(STRING));
    assert.deepStrictEqual(stringRecordRefs.get('child'), {kind: 'single'});
    assert.strictEqual(stringRecordRefs.has('children'), false);

    assert.strictEqual(refs(record(NUMBER)).size, 0);

    // An allOf must satisfy every stage's wire constraints.
    assert.strictEqual(refs(allOf(NUMBER, {})).size, 0);
    assert.strictEqual(refs(allOf({}, NUMBER)).size, 0);
  });

  it('extracts child and children fallbacks for empty-property and open objects while excluding closed ones', () => {
    for (const schema of [
      obj({}),
      obj({title: STRING}, {additionalProperties: true}),
      obj({title: STRING}, {additionalProperties: {}}),
    ]) {
      const r = refs(schema);
      assert.deepStrictEqual(r.get('child'), {kind: 'single'});
      assert.deepStrictEqual(r.get('children'), {kind: 'list'});
      assert.strictEqual(r.size, 2);
    }

    // Closed or incompatible-extra empty objects reject unknown `child`/`children` keys,
    // and an object that declares no property map is not an empty stub.
    assert.strictEqual(refs(obj({}, {additionalProperties: false})).size, 0);
    assert.strictEqual(refs(obj({}, {additionalProperties: NUMBER})).size, 0);
    assert.strictEqual(refs({type: 'object'}).size, 0);

    const stringExtraRefs = refs(obj({title: STRING}, {additionalProperties: STRING}));
    assert.deepStrictEqual(stringExtraRefs.get('child'), {kind: 'single'});
    assert.strictEqual(stringExtraRefs.has('children'), false);

    assert.strictEqual(refs(obj({title: STRING}, {additionalProperties: NUMBER})).size, 0);
  });

  it('extracts unannotated child, children, union properties, and nested item child fields with compatible types', () => {
    const schema = obj({
      title: STRING,
      child: STRING,
      children: arr(STRING),
      discriminatedList: anyOf(
        obj({mode: {type: 'string', const: 'template'}, componentId: STRING, path: STRING}),
        obj({mode: {type: 'string', const: 'none'}}),
      ),
      tabItems: arr(obj({title: STRING, child: STRING})),
      unionItems: arr(
        anyOf(
          obj({kind: {type: 'string', const: 'a'}, child: STRING}),
          obj({kind: {type: 'string', const: 'b'}, panel: CID}),
        ),
      ),
      intersectionItems: arr(allOf(obj({title: STRING}), obj({slot: CID}))),
    });

    const r = refs(schema);
    assert.deepStrictEqual(r.get('child'), {kind: 'single'});
    assert.deepStrictEqual(r.get('children'), {kind: 'list'});
    assert.deepStrictEqual(r.get('discriminatedList'), {kind: 'list'});
    assert.deepStrictEqual(r.get('tabItems'), {kind: 'nested', keys: new Set(['child'])});
    assert.deepStrictEqual(r.get('unionItems'), {
      kind: 'nested',
      keys: new Set(['child', 'panel']),
    });
    assert.deepStrictEqual(r.get('intersectionItems'), {kind: 'nested', keys: new Set(['slot'])});
    assert.strictEqual(r.has('title'), false);
  });

  it('supports oneOf, allOf, and unannotated component definitions inside a catalog document', () => {
    const catalog = {
      catalogId: 'https://example.com/dynamic-catalog.json',
      components: {
        EmptyLeaf: {type: 'object'},
        EmptyOpenBox: {type: 'object', additionalProperties: true},
        OpenBox: {
          allOf: [{$ref: `${COMMON}#/$defs/ComponentCommon`}, obj({title: STRING})],
          unevaluatedProperties: true,
        },
        UnannotatedContainer: obj({child: STRING, children: arr(STRING)}),
        OneOfSlotContainer: obj({
          slot: {oneOf: [CID, LIST]},
          count: {oneOf: [NUMBER, {type: 'boolean'}]},
        }),
        ClosedLeaf: obj({label: DYN_STRING}, {additionalProperties: false}),
      },
    };
    const doc = docOf(catalog);
    const component = (name: keyof typeof catalog.components) =>
      extractRefFields(catalog.components[name], doc);

    for (const name of ['EmptyOpenBox', 'OpenBox', 'UnannotatedContainer'] as const) {
      const r = component(name);
      assert.deepStrictEqual(r.get('child'), {kind: 'single'}, `${name}.child`);
      assert.deepStrictEqual(r.get('children'), {kind: 'list'}, `${name}.children`);
    }

    const oneOfRefs = component('OneOfSlotContainer');
    assert.deepStrictEqual(oneOfRefs.get('slot'), {kind: 'list'});
    assert.strictEqual(oneOfRefs.has('count'), false);

    for (const name of ['EmptyLeaf', 'ClosedLeaf'] as const) {
      assert.strictEqual(component(name).size, 0, `${name} refs`);
    }
  });

  it('does not misclassify closed non-child schemas or incompatible scalar types on child/children', () => {
    assert.strictEqual(refs(obj({text: DYN_STRING, variant: STRING})).size, 0);

    // An empty mixin intersected with a closed leaf schema is not an empty or open schema.
    assert.strictEqual(refs(allOf(obj({}), obj({text: STRING}))).size, 0);

    // Incompatible scalar/array types on `child` or `children` must not be classified as refs.
    assert.strictEqual(refs(obj({child: {type: 'boolean'}, children: NUMBER})).size, 0);
    assert.strictEqual(
      refs(
        obj({
          child: NUMBER,
          children: arr(NUMBER),
          items: arr(obj({title: STRING, child: NUMBER})),
        }),
      ).size,
      0,
    );

    // Explicit non-child A2UI refs on `child` / `children` must be respected.
    assert.strictEqual(refs(obj({child: DYN_STRING, children: ACTION})).size, 0);

    // On an open object, an explicitly incompatible `children` stays unclassified
    // while `child` still gets the open-schema fallback.
    const partialOpen = refs(obj({children: NUMBER}, {additionalProperties: true}));
    assert.deepStrictEqual(partialOpen.get('child'), {kind: 'single'});
    assert.strictEqual(partialOpen.has('children'), false);
  });

  it('merges ref fields across unions and intersections and caches results per schema', () => {
    const unionSchema = anyOf(
      obj({mode: {type: 'string', const: 'single'}, child: STRING}),
      obj({mode: {type: 'string', const: 'list'}, children: arr(STRING)}),
    );
    const doc = docOf(unionSchema);
    const unionRefs = extractRefFields(unionSchema, doc);
    assert.deepStrictEqual(unionRefs.get('child'), {kind: 'single'});
    assert.deepStrictEqual(unionRefs.get('children'), {kind: 'list'});
    assert.strictEqual(extractRefFields(unionSchema, doc), unionRefs);

    // Union branch ordering: a property that is `single` in one branch and `list` in another
    // must resolve to `list` regardless of branch order.
    const singleBranch = obj({slot: CID});
    const listBranch = obj({slot: LIST});
    assert.deepStrictEqual(refs(anyOf(singleBranch, listBranch)).get('slot'), {kind: 'list'});
    assert.deepStrictEqual(refs(anyOf(listBranch, singleBranch)).get('slot'), {kind: 'list'});
    assert.deepStrictEqual(refs(obj({slot: anyOf(CID, LIST)})).get('slot'), {kind: 'list'});

    // Intersection compatibility: narrowing an explicit ref field with a string keeps it,
    // while narrowing with a number, mutually incompatible ref kinds, or an incompatible
    // record drops it.
    assert.deepStrictEqual(refs(allOf(obj({header: CID}), obj({header: STRING}))).get('header'), {
      kind: 'single',
    });
    assert.strictEqual(refs(allOf(obj({header: CID}), obj({header: NUMBER}))).has('header'), false);
    assert.strictEqual(refs(obj({header: allOf(CID, NUMBER)})).has('header'), false);

    // Mutually incompatible `single` & `list` intersection accepts neither strings nor arrays.
    assert.strictEqual(refs(allOf(obj({slot: CID}), obj({slot: arr(CID)}))).size, 0);

    // Narrowing `single | list` with a string preserves `single`.
    assert.deepStrictEqual(
      refs(allOf(obj({slot: anyOf(CID, LIST)}), obj({slot: STRING}))).get('slot'),
      {kind: 'single'},
    );
    assert.deepStrictEqual(refs(obj({slot: allOf(anyOf(CID, LIST), STRING)})).get('slot'), {
      kind: 'single',
    });

    // Nested array of objects intersected with array of numbers drops the nested ref,
    // and intersecting two object-array schemas filters incompatible item sub-keys.
    assert.strictEqual(
      refs(allOf(obj({items: arr(obj({child: CID}))}), obj({items: arr(NUMBER)}))).size,
      0,
    );
    assert.deepStrictEqual(
      refs(
        allOf(
          obj({items: arr(obj({keep: CID, drop: CID}))}),
          obj({items: arr(obj({keep: STRING, drop: NUMBER}))}),
        ),
      ).get('items'),
      {kind: 'nested', keys: new Set(['keep'])},
    );

    assert.strictEqual(refs(allOf(obj({child: STRING}), record(NUMBER))).size, 0);

    const emptyRecordRefs = refs(allOf(obj({}), record(STRING)));
    assert.deepStrictEqual(emptyRecordRefs.get('child'), {kind: 'single'});
    assert.strictEqual(emptyRecordRefs.has('children'), false);

    // Standalone template object on a non-`children` key is recognized as `list`,
    // and array element classification respects allOf stages.
    const elementParityRefs = refs(
      obj({
        itemsTemplate: obj({componentId: STRING, path: STRING}),
        pipedIds: arr(allOf(CID, STRING)),
        invalidIntersectedIds: arr(allOf(CID, NUMBER)),
      }),
    );
    assert.deepStrictEqual(elementParityRefs.get('itemsTemplate'), {kind: 'list'});
    assert.deepStrictEqual(elementParityRefs.get('pipedIds'), {kind: 'list'});
    assert.strictEqual(elementParityRefs.has('invalidIntersectedIds'), false);

    // Intersecting an unconstrained non-empty object with an open schema retains open
    // child/children, unless unknown keys are closed or `child`/`children` is declared
    // with a non-ref type.
    const objectAndRecord = refs(allOf(obj({title: STRING}), record({})));
    assert.deepStrictEqual(objectAndRecord.get('child'), {kind: 'single'});
    assert.deepStrictEqual(objectAndRecord.get('children'), {kind: 'list'});

    const objectAndOpen = refs(allOf(obj({title: STRING}), obj({}, {additionalProperties: true})));
    assert.deepStrictEqual(objectAndOpen.get('child'), {kind: 'single'});
    assert.deepStrictEqual(objectAndOpen.get('children'), {kind: 'list'});

    assert.strictEqual(
      refs(allOf(obj({title: STRING}, {additionalProperties: false}), record({}))).size,
      0,
    );

    const nonRefChildAndRecord = refs(allOf(obj({child: NUMBER}), record({})));
    assert.strictEqual(nonRefChildAndRecord.has('child'), false);
    assert.deepStrictEqual(nonRefChildAndRecord.get('children'), {kind: 'list'});

    // Union of a branch declaring non-ref `child`/`children` and an open branch keeps open refs.
    const unionOpenWithNonRefChild = refs(
      anyOf(obj({child: NUMBER}), obj({title: STRING}, {additionalProperties: true})),
    );
    assert.deepStrictEqual(unionOpenWithNonRefChild.get('child'), {kind: 'single'});
    assert.deepStrictEqual(unionOpenWithNonRefChild.get('children'), {kind: 'list'});

    const unionOpenWithNonRefChildren = refs(anyOf(obj({children: NUMBER}), record({})));
    assert.deepStrictEqual(unionOpenWithNonRefChildren.get('child'), {kind: 'single'});
    assert.deepStrictEqual(unionOpenWithNonRefChildren.get('children'), {kind: 'list'});

    // An unconstrained stage followed by a closed object does not synthesize
    // unintended `child` or `children` slots; followed by an open one it does.
    assert.strictEqual(
      refs(allOf({}, obj({title: STRING}, {additionalProperties: false}))).size,
      0,
    );
    assert.strictEqual(refs(allOf(obj({}), obj({title: STRING}))).size, 0);
    const openToOpen = refs(allOf({}, obj({title: STRING}, {additionalProperties: true})));
    assert.deepStrictEqual(openToOpen.get('child'), {kind: 'single'});
    assert.deepStrictEqual(openToOpen.get('children'), {kind: 'list'});

    // Unmarked dynamic-binding/function-call unions on `child`/`children` are treated as dynamic
    // data properties, not component references, including nested unions and $ref cycles.
    assert.strictEqual(
      refs(
        obj({
          child: anyOf(STRING, obj({'@path': STRING})),
          children: anyOf(arr(STRING), obj({'@call': STRING})),
        }),
      ).size,
      0,
    );
    assert.strictEqual(
      refs(
        obj({
          child: anyOf(anyOf(obj({'@path': STRING}), obj({'@call': STRING})), STRING),
          children: anyOf(anyOf(obj({'@path': STRING}), obj({'@call': STRING})), arr(STRING)),
        }),
      ).size,
      0,
    );
    const cyclicNestedDynamic = {
      $defs: {D: anyOf(anyOf(obj({'@path': STRING}), {$ref: '#/$defs/D'}), STRING)},
      ...obj({child: {$ref: '#/$defs/D'}}),
    };
    assert.strictEqual(refs(cyclicNestedDynamic).size, 0);

    // Explicit child refs inside nested unions still classify as component references.
    const nestedExplicitChildRefs = refs(
      obj({
        child: anyOf(anyOf(obj({'@path': STRING}), CID), STRING),
        children: anyOf(anyOf(obj({'@path': STRING}), LIST), arr(STRING)),
      }),
    );
    assert.deepStrictEqual(nestedExplicitChildRefs.get('child'), {kind: 'single'});
    assert.deepStrictEqual(nestedExplicitChildRefs.get('children'), {kind: 'list'});
  });

  it('constrains open-branch union fallbacks through intersections', () => {
    const unionWithOpenBranch = anyOf(
      obj({title: STRING}, {additionalProperties: true}),
      obj({title: STRING, subtitle: STRING}),
    );
    assert.deepStrictEqual(refs(unionWithOpenBranch).get('child'), {kind: 'single'});
    assert.deepStrictEqual(refs(unionWithOpenBranch).get('children'), {kind: 'list'});

    // Intersecting open-branch union with unconstrained vs closed vs incompatible `child` objects.
    const unionAndPlain = refs(allOf(unionWithOpenBranch, obj({extra: STRING})));
    assert.deepStrictEqual(unionAndPlain.get('child'), {kind: 'single'});
    assert.deepStrictEqual(unionAndPlain.get('children'), {kind: 'list'});

    const unionAndIncompatibleChild = refs(allOf(unionWithOpenBranch, obj({child: NUMBER})));
    assert.strictEqual(unionAndIncompatibleChild.has('child'), false);
    assert.deepStrictEqual(unionAndIncompatibleChild.get('children'), {kind: 'list'});

    assert.strictEqual(
      refs(allOf(unionWithOpenBranch, obj({title: STRING}, {additionalProperties: false}))).size,
      0,
    );
  });

  it('merges [list, nested] and [single, nested] unions order-independently and narrows via intersections', () => {
    const structuredArray = arr(obj({title: STRING, child: CID}));

    const objListThenNested = anyOf(obj({sections: LIST}), obj({sections: structuredArray}));
    const objNestedThenList = anyOf(obj({sections: structuredArray}), obj({sections: LIST}));
    assert.deepStrictEqual(refs(objListThenNested).get('sections'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      refs(objListThenNested).get('sections'),
      refs(objNestedThenList).get('sections'),
    );

    const propListThenNested = obj({sections: anyOf(LIST, structuredArray)});
    const propNestedThenList = obj({sections: anyOf(structuredArray, LIST)});
    assert.deepStrictEqual(refs(propListThenNested).get('sections'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      refs(propListThenNested).get('sections'),
      refs(propNestedThenList).get('sections'),
    );

    const propSingleThenNested = obj({slot: anyOf(CID, structuredArray)});
    const propNestedThenSingle = obj({slot: anyOf(structuredArray, CID)});
    assert.deepStrictEqual(refs(propSingleThenNested).get('slot'), {
      kind: 'nested',
      keys: new Set(['child']),
    });
    assert.deepStrictEqual(
      refs(propSingleThenNested).get('slot'),
      refs(propNestedThenSingle).get('slot'),
    );

    // Narrowing a [list, nested] union with an array of strings yields {kind: 'list'}.
    assert.deepStrictEqual(
      refs(allOf(propListThenNested, obj({sections: arr(STRING)}))).get('sections'),
      {kind: 'list'},
    );

    // Narrowing a [single, nested] union with a string yields {kind: 'single'}.
    assert.deepStrictEqual(refs(allOf(propSingleThenNested, obj({slot: STRING}))).get('slot'), {
      kind: 'single',
    });
  });

  it('filters stripped element sub-keys in property-level nested array intersections', () => {
    const twoSubKeyArray = arr(obj({keep: CID, drop: CID}));
    const keepOnly = arr(obj({keep: STRING}));
    const keepOnlyClosed = arr(obj({keep: STRING}, {additionalProperties: false}));
    const keepOnlyIncompatibleDrop = arr(obj({keep: STRING, drop: NUMBER}));
    const dropAllClosed = arr(obj({label: STRING}, {additionalProperties: false}));

    // An unconstrained item object keeps both sub-keys.
    assert.deepStrictEqual(refs(obj({items: allOf(twoSubKeyArray, keepOnly)})).get('items'), {
      kind: 'nested',
      keys: new Set(['keep', 'drop']),
    });

    // Closed or incompatible constraints filter `drop`.
    for (const schema of [
      obj({items: allOf(twoSubKeyArray, keepOnlyClosed)}),
      obj({items: allOf(keepOnlyClosed, twoSubKeyArray)}),
      obj({items: allOf(twoSubKeyArray, keepOnlyIncompatibleDrop)}),
      obj({items: allOf(keepOnlyIncompatibleDrop, twoSubKeyArray)}),
      obj({items: allOf(anyOf(twoSubKeyArray, {type: 'null'}), keepOnlyClosed)}),
    ]) {
      assert.deepStrictEqual(refs(schema).get('items'), {kind: 'nested', keys: new Set(['keep'])});
    }

    for (const schema of [
      obj({items: allOf(twoSubKeyArray, dropAllClosed)}),
      obj({items: allOf(dropAllClosed, twoSubKeyArray)}),
    ]) {
      assert.strictEqual(refs(schema).has('items'), false);
    }

    // An explicit ComponentId intersected with a record of DynamicString keeps `child`
    // without inventing unannotated `child`/`children` fallbacks on standalone dynamic records.
    const dynamicString = {
      ...anyOf(STRING, obj({path: STRING})),
      description: 'REF:common_types.json#/$defs/DynamicString',
    };
    assert.strictEqual(refs(record(dynamicString)).size, 0);
    assert.deepStrictEqual(
      [...refs(allOf(record(dynamicString), obj({child: CID})))],
      [['child', {kind: 'single'}]],
    );
    assert.strictEqual(refs(allOf(record({}), obj({child: dynamicString}))).has('child'), false);
  });

  it('distinguishes oneOf dynamic bindings from child ref unions through local $defs', () => {
    const catalog = {
      catalogId: 'oneof-ref-test',
      $defs: {
        ComponentId: STRING,
        DataBinding: obj({path: STRING}, {required: ['path']}),
        FunctionCall: obj({call: STRING}, {required: ['call']}),
        NestedBindingUnion: {
          oneOf: [{$ref: '#/$defs/DataBinding'}, {$ref: '#/$defs/FunctionCall'}],
        },
      },
      components: {
        OneOfWidget: obj({
          child: {oneOf: [STRING, {$ref: '#/$defs/NestedBindingUnion'}]},
          children: {oneOf: [arr(STRING), {$ref: '#/$defs/NestedBindingUnion'}]},
          items: {
            oneOf: [
              arr(STRING),
              obj(
                {componentId: {$ref: '#/$defs/ComponentId'}, path: STRING},
                {required: ['componentId', 'path']},
              ),
            ],
          },
        }),
      },
    };

    const r = extractRefFields(catalog.components.OneOfWidget, docOf(catalog));
    assert.strictEqual(r.has('child'), false);
    assert.strictEqual(r.has('children'), false);
    assert.deepStrictEqual(r.get('items'), {kind: 'list'});
  });

  it('reads v0.8 child properties and explicitList/template children structurally', () => {
    const v08 = (root: JsonSchema) => extractRefFields(root, docOf(root), V08_CHILD_REF_OPTIONS);
    const template = obj(
      {componentId: STRING, dataBinding: STRING},
      {required: ['componentId', 'dataBinding'], additionalProperties: false},
    );
    const childrenItem = obj({explicitList: arr(STRING), template}, {additionalProperties: false});
    const literal = obj({literalString: STRING, path: STRING}, {additionalProperties: false});

    const column = v08(
      obj({children: childrenItem, alignment: STRING}, {additionalProperties: false}),
    );
    assert.deepStrictEqual([...column], [['children', {kind: 'list'}]]);

    const modal = v08(
      obj({entryPointChild: STRING, contentChild: STRING}, {additionalProperties: false}),
    );
    assert.deepStrictEqual(modal.get('entryPointChild'), {kind: 'single'});
    assert.deepStrictEqual(modal.get('contentChild'), {kind: 'single'});

    const tabs = v08(
      obj({tabItems: arr(obj({title: literal, child: STRING}))}, {additionalProperties: false}),
    );
    assert.deepStrictEqual(tabs.get('tabItems'), {kind: 'nested', keys: new Set(['child'])});

    // A literal-or-path value is data, not a child reference.
    assert.strictEqual(v08(obj({text: literal}, {additionalProperties: false})).size, 0);
  });
});
