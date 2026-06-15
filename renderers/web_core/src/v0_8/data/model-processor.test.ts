/*
 * Copyright 2025 Google LLC
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

import * as assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {A2uiMessageProcessor} from './model-processor.js';
import {TextNode, RowNode} from '../types/types.js';

describe('A2uiMessageProcessor', () => {
  let processor: A2uiMessageProcessor;

  beforeEach(() => {
    processor = new A2uiMessageProcessor();
  });

  it('handles beginRendering', () => {
    processor.processMessages([
      {
        beginRendering: {
          surfaceId: 's1',
          root: 'root',
          styles: {font: 'Arial'},
        },
      },
    ]);

    const surfaces = processor.getSurfaces();
    const surface = surfaces.get('s1')!;
    assert.ok(surface);
    assert.strictEqual(surface.rootComponentId, 'root');
    assert.deepStrictEqual(surface.styles, {font: 'Arial'});
    // The component tree remains null until components are added via surfaceUpdate.
    assert.strictEqual(surface.componentTree, null);
  });

  it('handles surfaceUpdate', () => {
    processor.processMessages([
      {
        beginRendering: {surfaceId: 's1', root: 'root'},
      },
    ]);

    processor.processMessages([
      {
        surfaceUpdate: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: {
                Text: {text: {literal: 'Hello'}, usageHint: 'body'},
              } as any,
            },
          ],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s1')!;
    assert.ok(surface);
    assert.ok(surface.componentTree);
    const root = surface.componentTree! as TextNode;
    assert.strictEqual(root.id, 'root');
    assert.strictEqual(root.type, 'Text');
    // The property preserves the literal wrapper
    assert.deepStrictEqual(root.properties.text, {literal: 'Hello'});
  });

  it('handles dataModelUpdate', () => {
    processor.processMessages([
      {
        beginRendering: {surfaceId: 's1', root: 'root'},
      },
      {
        dataModelUpdate: {
          surfaceId: 's1',
          contents: [{key: 'message', valueString: 'World'}],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s1');
    assert.strictEqual(surface?.dataModel.get('message'), 'World');
  });

  it('handles deleteSurface', () => {
    processor.processMessages([
      {
        beginRendering: {surfaceId: 's1', root: 'root'},
      },
    ]);
    assert.ok(processor.getSurfaces().has('s1'));

    processor.processMessages([
      {
        deleteSurface: {surfaceId: 's1'},
      },
    ]);
    assert.ok(!processor.getSurfaces().has('s1'));
  });

  it('resolves component references (children)', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's1', root: 'row'}},
      {
        surfaceUpdate: {
          surfaceId: 's1',
          components: [
            {
              id: 'row',
              component: {
                Row: {children: {explicitList: ['t1', 't2']}},
              } as any,
            },
            {
              id: 't1',
              component: {
                Text: {text: {literal: 'One'}, usageHint: 'body'},
              } as any,
            },
            {
              id: 't2',
              component: {
                Text: {text: {literal: 'Two'}, usageHint: 'body'},
              } as any,
            },
          ],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s1');
    const root = surface?.componentTree as RowNode;
    assert.strictEqual(root.type, 'Row');
    assert.strictEqual(root.properties.children.length, 2);
    assert.deepStrictEqual((root.properties.children[0] as TextNode).properties.text, {
      literal: 'One',
    });
    assert.deepStrictEqual((root.properties.children[1] as TextNode).properties.text, {
      literal: 'Two',
    });
  });

  it('resolves templates', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's1', root: 'row'}},
      {
        dataModelUpdate: {
          surfaceId: 's1',
          contents: [
            {
              key: 'items',
              valueMap: [
                {key: '0', valueString: 'Item A'},
                {key: '1', valueString: 'Item B'},
              ],
            },
          ],
        },
      },
      {
        surfaceUpdate: {
          surfaceId: 's1',
          components: [
            {
              id: 'row',
              component: {
                Row: {
                  children: {
                    template: {
                      componentId: 'item',
                      dataBinding: '/items',
                    },
                  },
                },
              } as any,
            },
            {
              id: 'item',
              component: {
                Text: {text: {path: '.'}, usageHint: 'body'},
              } as any,
            },
          ],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s1');
    const root = surface?.componentTree as RowNode;
    assert.strictEqual(root.type, 'Row');
    assert.strictEqual(root.properties.children.length, 2);

    // Verify template expansion
    const child0 = root.properties.children[0] as TextNode;
    const child1 = root.properties.children[1] as TextNode;

    // Check that binding paths are correct (processor does NOT resolve the value, just the binding path context)
    assert.deepStrictEqual(child0.properties.text, {path: '.'});

    // Now verify we can resolve the data using the node's context
    const textProp0 = child0.properties.text as {path: string};
    const resolvedValue0 = processor.getData(child0, textProp0.path, 's1');
    assert.strictEqual(resolvedValue0, 'Item A');

    const textProp1 = child1.properties.text as {path: string};
    const resolvedValue1 = processor.getData(child1, textProp1.path, 's1');
    assert.strictEqual(resolvedValue1, 'Item B');
  });

  it('getData resolves paths relative to node context', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's1', root: 'root'}},
      {
        dataModelUpdate: {
          surfaceId: 's1',
          contents: [{key: 'user', valueMap: [{key: 'name', valueString: 'Alice'}]}],
        },
      },
    ]);

    processor.getSurfaces().get('s1');
    const node = {id: 'test', dataContextPath: '/user'} as any;

    const name = processor.getData(node, 'name', 's1');
    assert.strictEqual(name, 'Alice');

    const self = processor.getData(node, '.', 's1');
    assert.ok(self instanceof Map);
    assert.strictEqual((self as Map<string, any>).get('name'), 'Alice');

    const rootData = processor.getData(node, '/user/name', 's1');
    assert.strictEqual(rootData, 'Alice');
  });

  it('setData updates data model', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's1', root: 'root'}}]);
    const surface = processor.getSurfaces().get('s1');
    const node = {id: 'test', dataContextPath: '/'} as any;

    processor.setData(node, 'count', 42, 's1');
    assert.strictEqual(surface?.dataModel.get('count'), 42);

    processor.setData(node, '/nested/value', 'foo', 's1');
    const nested = surface?.dataModel.get('nested') as Map<string, any>;
    assert.strictEqual(nested.get('value'), 'foo');
  });

  it('normalizes paths correctly', () => {
    const p = (processor as any).normalizePath('users[0].name');
    assert.strictEqual(p, '/users/0/name');
  });

  it('parses JSON strings in data', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's1', root: 'root'}}]);

    // Explicitly testing private/internal parsing logic via public update
    processor.processMessages([
      {
        dataModelUpdate: {
          surfaceId: 's1',
          contents: [{key: 'config', valueString: '{"theme":"dark"}'}],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s1');
    const config = surface?.dataModel.get('config') as any;
    assert.deepStrictEqual(config, {theme: 'dark'});
  });

  it('test basic edge cases and internal fallbacks', () => {
    // 1. clearSurfaces
    processor.processMessages([{beginRendering: {surfaceId: 's1', root: 'root'}}]);
    assert.strictEqual(processor.getSurfaces().size, 1);
    processor.clearSurfaces();
    assert.strictEqual(processor.getSurfaces().size, 0);

    // 2. setData with null node
    processor.processMessages([{beginRendering: {surfaceId: 's1', root: 'root'}}]);
    // Shouldn't throw
    processor.setData(null, 'foo', 'bar');

    // 3. setData with default data context (default to /)
    const node = {id: 'test', dataContextPath: undefined} as any;
    processor.setData(node, '.', 'value');
    const surface = processor.getSurfaces().get('s1')!;
    assert.strictEqual(surface.dataModel.get('.'), undefined); // Normal setDataByPath logic when root=/

    // 4. parseIfJsonString with invalid JSON layout
    processor.processMessages([
      {
        dataModelUpdate: {
          surfaceId: 's1',
          contents: [{key: 'badJson', valueString: '{bad" }'}],
        },
      },
    ]);
    assert.strictEqual(surface.dataModel.get('badJson'), '{bad" }'); // Returns original

    // 5. convertKeyValueArrayToMap with missing valueKey
    // Explicit array pass directly to internal mapping simulation
    (processor as any).setDataByPath(surface.dataModel, 'malformed', [
      {key: 'foo', unknownKey: 'bar'}, // missing value map/string etc
    ]);
    const malformed = surface.dataModel.get('malformed') as Map<string, any>;
    assert.strictEqual(malformed.has('foo'), false); // Skips processing

    // 6. object normalization at root
    (processor as any).setDataByPath(surface.dataModel, '/', {
      plain: 'object',
    });
    assert.strictEqual(surface.dataModel.get('plain'), 'object');

    // 7. non-map/object root fails gracefully
    (processor as any).setDataByPath(surface.dataModel, '/', 'stringroot');
    // Doesn't explode, just prints error internally
  });

  it('test array set operations and invalid primitive traversal', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's1', root: 'root'}}]);
    const surface = processor.getSurfaces().get('s1')!;

    // Manually set an array to avoid empty array being converted to Map
    surface.dataModel.set('list', ['dummy']);

    // Now it's an array at /list, set something deep inside it
    (processor as any).setDataByPath(surface.dataModel, '/list/0/name', 'Alice');

    // Also test setting a value directly on an array index
    (processor as any).setDataByPath(surface.dataModel, '/list/1', 'Bob');

    const list = surface.dataModel.get('list') as any[];
    assert.strictEqual(list[0].get('name'), 'Alice'); // It creates a Map for `name`
    assert.strictEqual(list[1], 'Bob');

    // Test getDataByPath failing traversal over a primitive
    (processor as any).setDataByPath(surface.dataModel, '/primitive', 'hello');
    const result = (processor as any).getDataByPath(surface.dataModel, '/primitive/invalid');
    assert.strictEqual(result, null);
  });

  it('test tree rebuilding edge cases', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's_tree', root: 'root'}}]);
    const surface = processor.getSurfaces().get('s_tree')!;

    // 1. rebuildComponentTree without rootComponentId
    surface.rootComponentId = null;
    (processor as any).rebuildComponentTree(surface);
    assert.strictEqual(surface.componentTree, null);

    // 2. Circular dependency
    surface.rootComponentId = 'circleA';
    surface.components.set('circleA', {
      id: 'circleA',
      component: {Row: {children: ['circleB']}} as any,
    });
    surface.components.set('circleB', {
      id: 'circleB',
      component: {Row: {children: ['circleA']}} as any,
    });

    assert.throws(() => {
      (processor as any).rebuildComponentTree(surface);
    }, /Circular dependency/);
  });

  it('throws A2uiValidationError for malformed components', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's_bad_comp', root: 'bad'}}]);
    const surface = processor.getSurfaces().get('s_bad_comp')!;
    surface.rootComponentId = 'bad';

    // Divider is omitted here because it has no required fields, so `{}` is valid.
    const types = [
      'Text',
      'Image',
      'Icon',
      'Video',
      'AudioPlayer',
      'Row',
      'Column',
      'List',
      'Card',
      'Tabs',
      'Modal',
      'Button',
      'CheckBox',
      'TextField',
      'DateTimeInput',
      'MultipleChoice',
      'Slider',
    ];

    for (const type of types) {
      assert.throws(() => {
        surface.components.set('bad', {
          id: 'bad',
          component: {
            [type]: {
              /* missing required fields */
            },
          } as any,
        });
        (processor as any).rebuildComponentTree(surface);
      }, /Invalid data; expected/);
    }

    // Default catch-all (doesn't throw, just passes it through)
    surface.components.set('bad', {
      id: 'bad',
      component: {CustomWidget: {foo: 'bar'}} as any,
    });
    (processor as any).rebuildComponentTree(surface);
    assert.strictEqual((surface.componentTree as any).type, 'CustomWidget');
  });

  it('resolves Template with Array data', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's3_arr', root: 'list'}},
      {
        dataModelUpdate: {
          surfaceId: 's3_arr',
          path: '/items',
          contents: [
            {key: '0', valueString: 'a'},
            {key: '1', valueString: 'b'},
          ],
        },
      },
    ]);
    const surface = processor.getSurfaces().get('s3_arr')!;

    surface.components.set('list', {
      id: 'list',
      component: {
        List: {
          children: {
            template: {dataBinding: '/items', componentId: 'item'},
          },
        },
      } as any,
    });
    surface.components.set('item', {
      id: 'item',
      component: {
        Text: {text: {literalString: 'hello'}, usageHint: 'body'},
      },
    });
    (processor as any).rebuildComponentTree(surface);

    const root = surface.componentTree as any;
    assert.strictEqual(root.properties.children.length, 2);
    assert.strictEqual(root.properties.children[0].id, 'item:0');
    assert.strictEqual(root.properties.children[0].dataContextPath, '/items/0');
    assert.strictEqual(root.properties.children[1].id, 'item:1');
    assert.strictEqual(root.properties.children[1].dataContextPath, '/items/1');
  });

  it('resolves Template with undefined/null data as empty array', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's3_null', root: 'list'}}]);
    const surface = processor.getSurfaces().get('s3_null')!;
    surface.components.set('list', {
      id: 'list',
      component: {
        List: {
          children: {
            template: {dataBinding: '/missingItems', componentId: 'item'},
          },
        },
      } as any,
    });
    surface.components.set('item', {
      id: 'item',
      component: {
        Text: {text: {literalString: 'hello'}, usageHint: 'body'},
      },
    });

    (processor as any).rebuildComponentTree(surface);

    const root = surface.componentTree as any;
    assert.deepStrictEqual(root.properties.children, []);
  });

  it('sets primitive at path via single array element with dot key', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's1_prim', root: 'list'}},
      {
        dataModelUpdate: {
          surfaceId: 's1_prim',
          path: '/nested/item',
          contents: [{key: '.', valueString: 'hello'}],
        },
      },
    ]);
    const surface = processor.getSurfaces().get('s1_prim')!;
    surface.components.set('list', {
      id: 'list',
      component: {Row: {children: {explicitList: []}}} as any,
    });
    (processor as any).rebuildComponentTree(surface);
    const root = surface.componentTree!;
    assert.strictEqual(processor.getData(root, '/nested/item', 's1_prim'), 'hello');

    // Test the fallback where valueString is absent but we pass something anyway
    assert.throws(() => {
      processor.processMessages([
        {
          dataModelUpdate: {
            surfaceId: 's1_prim',
            path: '/nested/malformed',
            contents: [{key: '.'} as any],
          },
        },
      ]);
    }, /must have exactly one value property/);
  });

  it('path resolves through primitive objects and arrays', () => {
    processor.processMessages([{beginRendering: {surfaceId: 's1_path', root: 'list'}}]);
    const surface = processor.getSurfaces().get('s1_path')!;
    surface.dataModel.set('obj', {
      nestedMap: new Map([['index', [1, 2, {val: 'hi'}]]]),
    });
    surface.components.set('list', {
      id: 'list',
      component: {Row: {children: {explicitList: []}}} as any,
    });
    (processor as any).rebuildComponentTree(surface);
    const root = surface.componentTree!;

    assert.strictEqual(processor.getData(root, '/obj/nestedMap/index/2/val', 's1_path'), 'hi');
    assert.strictEqual(
      processor.getData(root, '/obj/nestedMap/index/2/val/deeper', 's1_path'),
      null,
    );
  });

  it('builds all component types correctly', () => {
    const surfaceId = 's_all';
    processor.processMessages([{beginRendering: {surfaceId, root: 'col'}}]);
    const surface = processor.getSurfaces().get(surfaceId)!;

    const components = {
      col: {Column: {children: ['row']}},
      row: {Row: {children: ['card']}},
      card: {Card: {child: 'tabs'}},
      tabs: {
        Tabs: {
          tabItems: [{title: {literalString: 'T1'}, child: 'modal'}],
        },
      },
      modal: {Modal: {entryPointChild: 'list', contentChild: 'div'}},
      list: {List: {children: ['btn']}},
      btn: {Button: {child: 'btn_txt', action: 'act'}},
      btn_txt: {Text: {text: {literalString: 'Click'}}},
      div: {Divider: {}},
      chk: {
        CheckBox: {
          label: {literalString: 'Chk'},
          value: {literalBoolean: true},
        },
      },
      txt: {TextField: {label: {literalString: 'Txt'}}},
      dt: {DateTimeInput: {value: {literalString: '2022-01-01'}}},
      mc: {MultipleChoice: {selections: {literal: ['a']}}},
      sl: {Slider: {value: {literalNumber: 50}}},
      img: {Image: {url: {literalString: 'http://img'}}},
      icon: {Icon: {name: {literalString: 'home'}}},
      vid: {Video: {url: {literalString: 'http://vid'}}},
      aud: {AudioPlayer: {url: {literalString: 'http://aud'}}},
    };

    for (const [id, comp] of Object.entries(components)) {
      surface.components.set(id, {id, component: comp} as any);
    }

    surface.components.set('root_all', {
      id: 'root_all',
      component: {
        Column: {
          children: ['col', 'chk', 'txt', 'dt', 'mc', 'sl', 'img', 'icon', 'vid', 'aud'],
        },
      },
    } as any);

    surface.rootComponentId = 'root_all';
    (processor as any).rebuildComponentTree(surface);

    const root = surface.componentTree as any;
    assert.strictEqual(root.type, 'Column');
    assert.strictEqual(root.properties.children.length, 10);
  });

  it('handles recursive valueMap in convertKeyValueArrayToMap', () => {
    // We need to bypass private check or use a method that calls it.
    // setData calls setDataByPath which calls convertKeyValueArrayToMap.
    const update = {
      surfaceId: 's_rec',
      contents: [
        {
          key: 'nested',
          valueMap: [{key: 'inner', valueString: 'val'}],
        },
      ] as any, // Recursive generic type difficult to construct in TS literal
    };

    // We can use processMessages with dataModelUpdate.
    processor.processMessages([{beginRendering: {surfaceId: 's_rec', root: 'root'}}]);

    // Set root to Map first
    const surface = processor.getSurfaces().get('s_rec')!;
    (surface.dataModel as any).set('junk', 'ignored');

    processor.processMessages([{dataModelUpdate: update}]);

    // Verify data
    const nested = surface.dataModel.get('nested') as Map<string, any>;
    assert.strictEqual(nested instanceof Map, true);
    assert.strictEqual(nested.get('inner'), 'val');
  });

  it('resolves Template with Map data', () => {
    processor.processMessages([
      {beginRendering: {surfaceId: 's3_map', root: 'list'}},
      {
        dataModelUpdate: {
          surfaceId: 's3_map',
          contents: [
            {
              key: 'items',
              valueMap: [
                {key: 'a', valueString: 'valA'},
                {key: 'b', valueString: 'valB'},
              ],
            },
          ],
        },
      },
    ]);

    const surface = processor.getSurfaces().get('s3_map')!;

    // Define components
    surface.components.set('list', {
      id: 'list',
      component: {
        List: {
          children: {
            template: {
              dataBinding: '/items',
              componentId: 'item',
            },
          },
        },
      } as any,
    });
    surface.components.set('item', {
      id: 'item',
      component: {
        Text: {text: {path: '.'}},
      } as any,
    });

    (processor as any).rebuildComponentTree(surface);
    const root = surface.componentTree as any;
    assert.strictEqual(root.type, 'List');
    // Map entries should be processed.
    assert.strictEqual(root.properties.children.length, 2);
  });

  it('handles Object-to-Map normalization in handleDataModelUpdate (direct call)', () => {
    const surfaceId = 's_norm';
    processor.processMessages([{beginRendering: {surfaceId, root: 'root'}}]);
    const surface = processor.getSurfaces().get(surfaceId)!;

    // Direct call to bypass Zod validation in processMessages
    (processor as any).handleDataModelUpdate(
      {
        surfaceId,
        contents: {normalized: 'value'},
      },
      surfaceId,
    );

    assert.strictEqual(surface.dataModel.get('normalized'), 'value');
  });

  it('throws validation error for invalid List', () => {
    const surfaceId = 's_bad_list';
    processor.processMessages([{beginRendering: {surfaceId, root: 'badList'}}]);
    const surface = processor.getSurfaces().get(surfaceId)!;

    surface.components.set('badList', {
      id: 'badList',
      component: {List: {children: 'not-array'}} as any,
    });

    assert.throws(() => {
      (processor as any).rebuildComponentTree(surface);
    }, /Invalid data; expected List/);
  });

  it('handles recursive valueMap in convertKeyValueArrayToMap with dot key', () => {
    const surfaceId = 's_dot_rec';
    const surface = (processor as any).getOrCreateSurface(surfaceId);
    const value = [
      {
        key: '.',
        valueMap: [{key: 'inner', valueString: 'val'}],
      },
    ];

    // Calling setDataByPath directly (private)
    (processor as any).setDataByPath(surface.dataModel, '/target', value);

    const target = surface.dataModel.get('target') as Map<string, any>;
    assert.strictEqual(target instanceof Map, true);
    assert.strictEqual(target.get('inner'), 'val');
  });

  it('resolves Template with Array data (via direct setData)', () => {
    const surfaceId = 's_direct_arr';
    processor.processMessages([{beginRendering: {surfaceId, root: 'list'}}]);
    const surface = processor.getSurfaces().get(surfaceId)!;

    // Setup components
    surface.components.set('list', {
      id: 'list',
      component: {
        List: {
          children: {
            template: {
              dataBinding: '/items',
              componentId: 'item',
            },
          },
        },
      } as any,
    });
    surface.components.set('item', {
      id: 'item',
      component: {
        Text: {text: {path: '.'}},
      } as any,
    });

    // Direct set array to bypass normalization/schema
    const itemsArray = ['A', 'B'];
    surface.dataModel.set('items', itemsArray);

    (processor as any).rebuildComponentTree(surface);

    const root = surface.componentTree as any;
    assert.strictEqual(root.type, 'List');
    assert.strictEqual(root.properties.children.length, 2);
  });

  it('ignores non-strings when trying to parse JSON', () => {
    const result = (processor as any).parseIfJsonString(123);
    assert.strictEqual(result, 123);
  });
});
