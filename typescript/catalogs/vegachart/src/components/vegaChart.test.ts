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

// tslint:disable:ban-malformed-import-paths
import './vegaChart.shim.spec.js';

import * as assert from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  afterEach as nodeAfterEach,
  beforeEach as nodeBeforeEach,
  describe as nodeDescribe,
  it as nodeIt,
} from 'node:test';

import {Catalog, ComponentContext, ComponentModel, SurfaceModel} from '@a2ui/web_core/v1_0';

import {
  A2uiVegaChart,
  A2uiVegaChartElement,
  A2uiVegaChartV1,
  createVegaChartCatalog,
  createVegaChartV1Catalog,
  DEFAULT_HEIGHT,
  transformSpec,
  VEGACHART_CATALOG_ID,
  VEGACHART_V1_CATALOG_ID,
  VegaChartApi,
  vegachartCatalog,
  VegaChartV1Api,
  vegachartV1Catalog,
} from '../index.js';

// Support both Node's built-in test runner (`node --test`) and Google3's
// `jasmine_node_test` runner seamlessly.
const g = globalThis as Record<string, unknown>;
const hasJasmine = Boolean(g['jasmine']);
const describe = (hasJasmine ? g['describe'] : nodeDescribe) as typeof nodeDescribe;
const it = (hasJasmine ? g['it'] : nodeIt) as typeof nodeIt;
const beforeEach = (hasJasmine ? g['beforeEach'] : nodeBeforeEach) as typeof nodeBeforeEach;
const afterEach = (hasJasmine ? g['afterEach'] : nodeAfterEach) as typeof nodeAfterEach;

interface MockResizeObserverEntry {
  contentRect: {width: number; height: number};
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly callback: (entries: MockResizeObserverEntry[]) => void;
  observedTarget?: HTMLElement;

  constructor(callback: (entries: MockResizeObserverEntry[]) => void) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(target: HTMLElement) {
    this.observedTarget = target;
  }

  unobserve() {}

  disconnect() {
    this.observedTarget = undefined;
  }

  trigger(width: number, height: number) {
    this.callback([{contentRect: {width, height}}]);
  }
}

interface ShimElement {
  id: string;
  className: string;
  localName?: string;
  tagName?: string;
  style: Record<string, unknown> & {
    setProperty: (k: string, v: string) => void;
    removeProperty: (k: string) => void;
    getPropertyValue: (k: string) => string;
  };
  children: ShimElement[];
  parentElement: ShimElement | null;
  isConnected: boolean;
  offsetParent: Element | null;
  connectedCallback?: () => void;
  disconnectedCallback?: () => void;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  hasAttribute: (name: string) => boolean;
  removeAttribute: (name: string) => void;
  appendChild: <T extends ShimElement>(child: T) => T;
  remove: () => void;
  replaceChildren: (...nodes: ShimElement[]) => void;
  querySelector: (selector: string) => ShimElement | null;
  getBoundingClientRect: () => DOMRect;
  getClientRects: () => DOMRectList;
}

function createStyleObject() {
  const store: Record<string, string> = {};
  const styleObj: Record<string, unknown> = {
    height: '',
    minHeight: '',
    width: '',
    overflow: '',
    flex: '',
    setProperty(k: string, v: string) {
      store[k] = v;
      styleObj[k] = v;
    },
    removeProperty(k: string) {
      delete store[k];
      styleObj[k] = '';
    },
    getPropertyValue(k: string) {
      return store[k] ?? (styleObj[k] as string) ?? '';
    },
  };
  return styleObj as ShimElement['style'];
}

function matchesSelector(el: ShimElement, selector: string): boolean {
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return (el.className || '').split(/\s+/).includes(selector.slice(1));
  }
  const tag = (el.localName || el.tagName || '').toLowerCase();
  return tag === selector.toLowerCase();
}

function setConnectedTree(el: ShimElement, connected: boolean) {
  const wasConnected = el.isConnected;
  el.isConnected = connected;
  if (!wasConnected && connected && typeof el.connectedCallback === 'function') {
    el.connectedCallback();
  } else if (wasConnected && !connected && typeof el.disconnectedCallback === 'function') {
    el.disconnectedCallback();
  }
  for (const child of el.children ?? []) {
    setConnectedTree(child, connected);
  }
}

function ensureElementMethods(proto: Record<string, unknown>) {
  const attrMap = new WeakMap<object, Map<string, string>>();
  const styleMap = new WeakMap<object, ShimElement['style']>();
  const childrenMap = new WeakMap<object, ShimElement[]>();

  const getAttrs = (obj: object) => {
    let m = attrMap.get(obj);
    if (!m) {
      m = new Map();
      attrMap.set(obj, m);
    }
    return m;
  };

  if (!Object.getOwnPropertyDescriptor(proto, 'style')) {
    Object.defineProperty(proto, 'style', {
      configurable: true,
      get(this: object) {
        let s = styleMap.get(this);
        if (!s) {
          s = createStyleObject();
          styleMap.set(this, s);
        }
        return s;
      },
    });
  }

  if (!Object.getOwnPropertyDescriptor(proto, 'children')) {
    Object.defineProperty(proto, 'children', {
      configurable: true,
      get(this: object) {
        let c = childrenMap.get(this);
        if (!c) {
          c = [];
          childrenMap.set(this, c);
        }
        return c;
      },
    });
  }

  if (typeof proto['getAttribute'] !== 'function') {
    proto['getAttribute'] = function (this: object, name: string) {
      return getAttrs(this).get(name) ?? null;
    };
  }
  if (typeof proto['setAttribute'] !== 'function') {
    proto['setAttribute'] = function (this: object, name: string, val: string) {
      getAttrs(this).set(name, String(val));
    };
  }
  if (typeof proto['hasAttribute'] !== 'function') {
    proto['hasAttribute'] = function (this: object, name: string) {
      return getAttrs(this).has(name);
    };
  }
  if (typeof proto['removeAttribute'] !== 'function') {
    proto['removeAttribute'] = function (this: object, name: string) {
      getAttrs(this).delete(name);
    };
  }

  proto['appendChild'] = function <T extends ShimElement>(this: ShimElement, child: T): T {
    if (child.parentElement) {
      const idx = child.parentElement.children.indexOf(child);
      if (idx >= 0) child.parentElement.children.splice(idx, 1);
    }
    this.children.push(child);
    child.parentElement = this;
    setConnectedTree(child, Boolean(this.isConnected));
    return child;
  };

  proto['remove'] = function (this: ShimElement) {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    setConnectedTree(this, false);
  };

  proto['replaceChildren'] = function (this: ShimElement, ...nodes: ShimElement[]) {
    for (const child of [...this.children]) {
      child.parentElement = null;
      setConnectedTree(child, false);
    }
    this.children.length = 0;
    for (const node of nodes) {
      this.appendChild(node);
    }
  };

  proto['querySelector'] = function (this: ShimElement, selector: string): ShimElement | null {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        return child;
      }
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  };

  if (typeof proto['getBoundingClientRect'] !== 'function') {
    proto['getBoundingClientRect'] = (): DOMRect =>
      ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  if (typeof proto['getClientRects'] !== 'function') {
    proto['getClientRects'] = (): DOMRectList => [] as unknown as DOMRectList;
  }

  if (typeof proto['getRootNode'] !== 'function') {
    proto['getRootNode'] = () => g['document'];
  }
}

function installTestDomEnvironment() {
  g['ResizeObserver'] = MockResizeObserver;
  g['requestAnimationFrame'] = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);

  if (typeof HTMLTemplateElement !== 'undefined') {
    return;
  }

  const BaseHTMLElement = (g['HTMLElement'] ?? class HTMLElement {}) as unknown as {
    new (): ShimElement;
    prototype: Record<string, unknown>;
  };
  ensureElementMethods(BaseHTMLElement.prototype);
  ensureElementMethods(
    Object.getPrototypeOf(A2uiVegaChartElement.prototype) as Record<string, unknown>,
  );

  const createShimElement = (tagName: string): ShimElement => {
    const el = new BaseHTMLElement();
    el.id = '';
    el.className = '';
    el.localName = tagName.toLowerCase();
    Object.defineProperty(el, 'tagName', {
      configurable: true,
      get: () => tagName.toUpperCase(),
    });
    el.parentElement = null;
    el.isConnected = false;
    el.offsetParent = null;
    return el;
  };

  const body = createShimElement('body');
  body.isConnected = true;
  const head = createShimElement('head');
  head.isConnected = true;

  const doc = (g['document'] ?? {}) as Record<string, unknown>;
  doc['body'] = body;
  doc['head'] = head;
  doc['adoptedStyleSheets'] = [];
  doc['createElement'] = (tagName: string) => createShimElement(tagName);
  g['document'] = doc;
}

installTestDomEnvironment();

function readCatalogJson(relativeFromRepoRoot: string): Record<string, unknown> {
  const candidates = [
    resolve(process.cwd(), relativeFromRepoRoot),
    resolve(process.cwd(), 'third_party/a2ui', relativeFromRepoRoot),
    resolve(process.cwd(), '../../..', relativeFromRepoRoot),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf-8')) as Record<string, unknown>;
    }
  }
  throw new Error(`Could not locate ${relativeFromRepoRoot} from ${process.cwd()}`);
}

const v09CatalogJson = readCatalogJson('catalogs/vegachart/catalog.json');
const v1CatalogJson = readCatalogJson('catalogs/vegachart/v1/catalog.json');

describe('VegaChart catalog schema', () => {
  it('round-trips catalogs/vegachart/catalog.json (v0.9) unchanged through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(v09CatalogJson);
    assert.strictEqual(loaded.id, VEGACHART_CATALOG_ID);
    assert.deepStrictEqual(loaded.toJson(), v09CatalogJson);
  });

  it('round-trips catalogs/vegachart/v1/catalog.json (v1.0) unchanged through Catalog.fromJson', () => {
    const loaded = Catalog.fromJson(v1CatalogJson);
    assert.strictEqual(loaded.id, VEGACHART_V1_CATALOG_ID);
    assert.strictEqual(loaded.protocolVersion, '1.0');
    assert.deepStrictEqual(loaded.toJson(), v1CatalogJson);
  });

  it('serializes vegachartCatalog (v0.9) and vegachartV1Catalog (v1.0) to match canonical catalog.json files', () => {
    assert.deepStrictEqual(vegachartCatalog.toJson(), v09CatalogJson);
    assert.deepStrictEqual(vegachartV1Catalog.toJson(), v1CatalogJson);
  });

  it('validates VegaChart properties with VegaChartApi and VegaChartV1Api', () => {
    for (const api of [VegaChartApi, VegaChartV1Api]) {
      assert.strictEqual(
        api.schema.safeParse({
          spec: {mark: 'bar', data: {values: [{x: 'A', y: 10}]}},
        }).success,
        true,
      );
      assert.strictEqual(api.schema.safeParse({}).success, false);
      assert.strictEqual(
        api.schema.safeParse({spec: {mark: 'bar'}, unknownProp: true}).success,
        false,
      );
    }

    assert.strictEqual(
      VegaChartApi.schema.safeParse({
        spec: {path: '/chart/spec'},
        height: 360,
        weight: 1,
      }).success,
      true,
    );
    assert.strictEqual(
      VegaChartApi.schema.safeParse({
        spec: {path: '/chart/spec'},
        height: {path: '/chart/height'},
      }).success,
      true,
    );
    assert.strictEqual(
      VegaChartV1Api.schema.safeParse({
        spec: {'@path': '/chart/spec'},
        height: {'@path': '/chart/height'},
        weight: 1,
      }).success,
      true,
    );
  });
});

describe('transformSpec', () => {
  describe('standard charts', () => {
    it('sets default config, autosize fit, and dimensions', () => {
      const spec = {
        mark: 'bar',
        encoding: {
          x: {field: 'a', type: 'ordinal'},
          y: {field: 'b', type: 'quantitative'},
        },
      };

      const result = transformSpec(spec, 300, 500);

      assert.deepStrictEqual(result['autosize'], {
        type: 'fit',
        contains: 'padding',
      });
      assert.strictEqual(result['height'], 300);
      assert.strictEqual(result['width'], 500);
      const config = result['config'] as Record<string, unknown>;
      assert.strictEqual(config['background'], 'transparent');
    });

    it('falls back to "container" width and default height 290 when not provided', () => {
      const spec = {mark: 'line'};
      const result = transformSpec(spec);

      assert.strictEqual(result['height'], DEFAULT_HEIGHT);
      assert.strictEqual(result['width'], 'container');
    });

    it('preserves user config while merging defaults', () => {
      const spec = {
        mark: 'point',
        config: {
          background: 'white',
          axis: {
            labelColor: 'red',
          },
          view: {
            stroke: 'black',
          },
        },
      };

      const result = transformSpec(spec);
      const config = result['config'] as Record<string, unknown>;
      const axis = config['axis'] as Record<string, unknown>;
      const view = config['view'] as Record<string, unknown>;

      assert.strictEqual(config['background'], 'white');
      assert.strictEqual(axis['labelColor'], 'red');
      assert.strictEqual(axis['titleColor'], '#202124');
      assert.strictEqual(view['stroke'], 'black');
    });
  });

  describe('faceted charts', () => {
    it('calculates dimensions for encoding.facet with nominal y-axis and bar mark', () => {
      const spec = {
        data: {
          values: [
            {cat: 'A', item: '1', val: 10},
            {cat: 'A', item: '2', val: 20},
            {cat: 'A', item: '3', val: 30},
            {cat: 'B', item: '1', val: 15},
          ],
        },
        mark: 'bar',
        encoding: {
          facet: {field: 'cat', columns: 2},
          y: {field: 'item', type: 'nominal'},
          x: {field: 'val', type: 'quantitative'},
        },
      };

      const result = transformSpec(spec, 300, 800);

      assert.deepStrictEqual(result['autosize'], {type: 'pad'});
      // 3 items in facet A * 25px = 75, max(100, 75) = 100
      assert.strictEqual(result['height'], 100);
      // effectiveCols = min(2, 2) = 2; availableWidth = 800 - 120 = 680; width = 340
      assert.strictEqual(result['width'], 340);
    });

    it('calculates dimensions for encoding.column with ordinal x-axis and point mark', () => {
      const spec = {
        data: {
          values: [
            {col: 'C1', xVal: 'X1', yVal: 1},
            {col: 'C1', xVal: 'X2', yVal: 2},
            {col: 'C1', xVal: 'X3', yVal: 3},
            {col: 'C1', xVal: 'X4', yVal: 4},
            {col: 'C1', xVal: 'X5', yVal: 5},
          ],
        },
        mark: {type: 'point'},
        encoding: {
          column: {field: 'col'},
          x: {field: 'xVal', type: 'ordinal'},
          y: {field: 'yVal', type: 'quantitative'},
        },
      };

      const result = transformSpec(spec, 300, 600);

      assert.deepStrictEqual(result['autosize'], {type: 'pad'});
      // 5 items * 40px (point mark) = 200, max(150, 200) = 200
      assert.strictEqual(result['width'], 200);
      assert.strictEqual(result['height'], 200);
    });

    it('calculates dimensions for top-level facet operator and moves width/height into inner spec', () => {
      const spec = {
        data: {
          name: 'myData',
        },
        datasets: {
          myData: [
            {r: 'R1', x: 1, y: 2},
            {r: 'R2', x: 3, y: 4},
          ],
        },
        facet: {
          row: {field: 'r'},
        },
        spec: {
          mark: 'line',
          encoding: {
            x: {field: 'x', type: 'quantitative'},
            y: {field: 'y', type: 'quantitative'},
          },
        },
        width: 500,
        height: 500,
      };

      const result = transformSpec(spec, 300, 400);
      const innerSpec = result['spec'] as Record<string, unknown>;

      assert.deepStrictEqual(result['autosize'], {type: 'pad'});
      assert.strictEqual(result['width'], undefined);
      assert.strictEqual(result['height'], undefined);
      assert.strictEqual(innerSpec['height'], 200);
      assert.strictEqual(innerSpec['width'], 340);
    });
  });

  describe('temporal axis formatting', () => {
    it('adds %Y and labelAngle -45 to temporal axis with %b format', () => {
      const spec = {
        mark: 'line',
        encoding: {
          x: {
            field: 'date',
            type: 'temporal',
            axis: {format: '%b'},
          },
        },
      };

      const result = transformSpec(spec);
      const encoding = result['encoding'] as Record<string, unknown>;
      const x = encoding['x'] as Record<string, unknown>;
      const axis = x['axis'] as Record<string, unknown>;

      assert.strictEqual(axis['format'], '%b %Y');
      assert.strictEqual(axis['labelAngle'], -45);
    });

    it('does not modify format if %Y is already present, and preserves existing labelAngle', () => {
      const spec = {
        mark: 'line',
        encoding: {
          x: {
            field: 'date',
            type: 'temporal',
            axis: {format: '%b %Y', labelAngle: 0},
          },
          y: {
            field: 'date2',
            timeUnit: 'yearmonth',
            axis: {format: '%b', labelAngle: 30},
          },
        },
      };

      const result = transformSpec(spec);
      const encoding = result['encoding'] as Record<string, unknown>;
      const xAxis = (encoding['x'] as Record<string, unknown>)['axis'] as Record<string, unknown>;
      const yAxis = (encoding['y'] as Record<string, unknown>)['axis'] as Record<string, unknown>;

      assert.strictEqual(xAxis['format'], '%b %Y');
      assert.strictEqual(xAxis['labelAngle'], 0);
      assert.strictEqual(yAxis['format'], '%b %Y');
      assert.strictEqual(yAxis['labelAngle'], 30);
    });

    it('fixes temporal axes inside layer and nested spec', () => {
      const spec = {
        layer: [
          {
            encoding: {
              x: {
                field: 'date',
                type: 'temporal',
                axis: {format: '%b %d'},
              },
            },
          },
        ],
        spec: {
          encoding: {
            y: {
              field: 'month',
              timeUnit: 'month',
              axis: {format: '%b'},
            },
          },
        },
      };

      const result = transformSpec(spec);
      const layer0 = (result['layer'] as Array<Record<string, unknown>>)[0];
      const layerEncoding = layer0['encoding'] as Record<string, unknown>;
      const layerXAxis = (layerEncoding['x'] as Record<string, unknown>)['axis'] as Record<
        string,
        unknown
      >;

      const nestedSpec = result['spec'] as Record<string, unknown>;
      const nestedEncoding = nestedSpec['encoding'] as Record<string, unknown>;
      const nestedYAxis = (nestedEncoding['y'] as Record<string, unknown>)['axis'] as Record<
        string,
        unknown
      >;

      assert.strictEqual(layerXAxis['format'], '%b %Y %d');
      assert.strictEqual(layerXAxis['labelAngle'], -45);
      assert.strictEqual(nestedYAxis['format'], '%b %Y');
      assert.strictEqual(nestedYAxis['labelAngle'], -45);
    });
  });
});

describe('A2uiVegaChartElement', () => {
  let hostContainer: HTMLElement;
  const initialDefaultEmbedFn = A2uiVegaChartElement.defaultEmbedFn;

  beforeEach(() => {
    MockResizeObserver.instances = [];
    hostContainer = document.createElement('div');
    document.body.appendChild(hostContainer);
  });

  afterEach(() => {
    hostContainer.remove();
    A2uiVegaChartElement.defaultEmbedFn = initialDefaultEmbedFn;
  });

  function mockContainerRect(
    element: A2uiVegaChartElement,
    width: number,
    height: number,
    attached = true,
  ) {
    const chartContainer = element.renderRoot.querySelector<HTMLElement>('#chart-container');
    if (chartContainer) {
      chartContainer.getBoundingClientRect = () =>
        ({
          width,
          height,
          top: 0,
          left: 0,
          bottom: height,
          right: width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }
    element.getClientRects = () => (attached ? [{} as DOMRect] : []) as unknown as DOMRectList;
  }

  async function settle() {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
  }

  it('renders a Vega-Lite spec bound via A2UI ComponentContext and reacts to DataModel updates', async () => {
    const renderedSpecs: Array<Record<string, unknown>> = [];
    let finalizedCount = 0;

    const catalog = createVegaChartCatalog({
      embedFn: async (el, chartSpec) => {
        renderedSpecs.push(chartSpec);
        const iframe = document.createElement('iframe');
        el.appendChild(iframe);
        return {
          finalize: () => {
            finalizedCount++;
          },
        };
      },
    });

    const surface = new SurfaceModel('surface-1', catalog);
    surface.dataModel.set('/chartSpec', {
      description: 'Revenue chart',
      mark: 'bar',
      data: {values: [{x: 'Q1', y: 100}]},
    });

    const model = new ComponentModel(
      'chart-1',
      'VegaChart',
      {
        spec: {path: '/chartSpec'},
        height: 340,
        weight: 2,
      },
      catalog,
    );
    surface.componentsModel.addComponent(model);
    const context = new ComponentContext(surface, 'chart-1');

    const el = new A2uiVegaChartElement();
    el.context = context;
    hostContainer.appendChild(el);
    await el.updateComplete;

    assert.ok(el.style.flex.startsWith('2'));

    mockContainerRect(el, 640, 340);
    const ro = MockResizeObserver.instances.at(-1);
    ro?.trigger(640, 340);
    await settle();

    assert.strictEqual(renderedSpecs.length, 1);
    assert.strictEqual(renderedSpecs[0]['width'], 640);
    assert.strictEqual(renderedSpecs[0]['height'], 340);

    const iframe = el.renderRoot.querySelector('iframe');
    assert.ok(iframe);
    assert.strictEqual(iframe.getAttribute('title'), 'Revenue chart');
    assert.strictEqual(iframe.getAttribute('aria-label'), 'Revenue chart');
    assert.strictEqual(iframe.style.height, '340px');

    // Update the data model reactively
    surface.dataModel.set('/chartSpec', {
      description: 'Updated revenue chart',
      mark: 'line',
      data: {values: [{x: 'Q1', y: 200}]},
    });
    await el.updateComplete;
    await settle();

    assert.strictEqual(renderedSpecs.length, 2);
    assert.strictEqual(finalizedCount, 1);
    assert.strictEqual(renderedSpecs[1]['mark'], 'line');
  });

  it('falls back to FALLBACK_WIDTH_PX (400) when container width stays 0 after two rAFs, then re-renders on resize', async () => {
    const renderedSpecs: Array<Record<string, unknown>> = [];
    const el = new A2uiVegaChartElement();
    el.embedFn = async (_container, chartSpec) => {
      renderedSpecs.push(chartSpec);
      return {};
    };
    el.spec = {
      mark: 'bar',
      data: {values: [{a: 'X', b: 1}]},
    };

    hostContainer.appendChild(el);
    await el.updateComplete;
    // Simulate a flex item with width 0 but positive min-height (290) that is attached
    mockContainerRect(el, 0, 290, true);

    await settle();

    assert.strictEqual(renderedSpecs.length, 1);
    assert.strictEqual(renderedSpecs[0]['width'], A2uiVegaChartElement.FALLBACK_WIDTH_PX);
    const chartContainer = el.renderRoot.querySelector<HTMLElement>('#chart-container')!;
    assert.strictEqual(el.style.width, `${A2uiVegaChartElement.FALLBACK_WIDTH_PX}px`);
    assert.strictEqual(chartContainer.style.width, `${A2uiVegaChartElement.FALLBACK_WIDTH_PX}px`);

    // Now ResizeObserver reports a real measured width of 720px
    const ro = MockResizeObserver.instances.at(-1);
    ro?.trigger(720, 290);
    await settle();

    assert.strictEqual(renderedSpecs.length, 2);
    assert.strictEqual(renderedSpecs[1]['width'], 720);
    assert.strictEqual(el.style.width, '');
    assert.strictEqual(chartContainer.style.width, '100%');
  });

  it('does not render with stale dimensions when detached and reattached into a display:none container', async () => {
    const renderedSpecs: Array<Record<string, unknown>> = [];
    const el = new A2uiVegaChartElement();
    el.embedFn = async (_container, chartSpec) => {
      renderedSpecs.push(chartSpec);
      return {};
    };
    el.spec = {
      mark: 'bar',
      data: {values: [{a: 'X', b: 1}]},
    };

    hostContainer.appendChild(el);
    await el.updateComplete;
    mockContainerRect(el, 500, 290, true);
    const ro = MockResizeObserver.instances.at(-1);
    ro?.trigger(500, 290);
    await settle();
    assert.strictEqual(renderedSpecs.length, 1);

    // Detach and reattach while hidden (display: none)
    el.remove();
    mockContainerRect(el, 0, 0, false);
    hostContainer.appendChild(el);
    await el.updateComplete;
    await settle();

    assert.strictEqual(
      renderedSpecs.length,
      1,
      'must not re-render while hidden after reattachment',
    );
  });

  it('does not render when inside a display:none subtree', async () => {
    const renderedSpecs: Array<Record<string, unknown>> = [];
    const el = new A2uiVegaChartElement();
    el.embedFn = async (_container, chartSpec) => {
      renderedSpecs.push(chartSpec);
      return {};
    };
    el.spec = {
      mark: 'bar',
      data: {values: [{a: 'X', b: 1}]},
    };

    hostContainer.appendChild(el);
    await el.updateComplete;
    // Simulate display: none (width=0, height=0, getClientRects empty)
    mockContainerRect(el, 0, 0, false);

    await settle();
    assert.strictEqual(renderedSpecs.length, 0);
  });

  it('aborts in-flight embed when spec changes mid-render and finalizes stale view', async () => {
    let resolveFirst!: (res: {finalize: () => void}) => void;
    let firstFinalized = false;
    let secondFinalized = false;

    const el = new A2uiVegaChartElement();
    let callCount = 0;
    el.embedFn = (_container, _chartSpec) => {
      callCount++;
      if (callCount === 1) {
        return new Promise(res => {
          resolveFirst = res;
        });
      }
      return Promise.resolve({
        finalize: () => {
          secondFinalized = true;
        },
      });
    };
    el.spec = {mark: 'bar'};

    hostContainer.appendChild(el);
    await el.updateComplete;
    mockContainerRect(el, 500, 290);
    const ro = MockResizeObserver.instances.at(-1);
    ro?.trigger(500, 290);

    // Trigger a spec update before the first embed resolves
    el.spec = {mark: 'line'};
    await el.updateComplete;
    await settle();

    // Now resolve the stale first embed
    resolveFirst({
      finalize: () => {
        firstFinalized = true;
      },
    });
    await settle();

    assert.strictEqual(firstFinalized, true, 'stale embed result must be finalized');
    assert.strictEqual(
      secondFinalized,
      false,
      'active embed result must stay alive until disconnect',
    );

    // Disconnecting finalizes the active chart
    el.remove();
    assert.strictEqual(secondFinalized, true);
  });

  it('exposes A2uiVegaChart and A2uiVegaChartV1 WebComponentImplementations with tagName a2ui-vega-chart', () => {
    assert.strictEqual(A2uiVegaChart.name, 'VegaChart');
    assert.strictEqual(A2uiVegaChart.tagName, 'a2ui-vega-chart');
    assert.strictEqual(A2uiVegaChart.element, A2uiVegaChartElement);
    assert.strictEqual(A2uiVegaChartV1.name, 'VegaChart');
    assert.strictEqual(A2uiVegaChartV1.tagName, 'a2ui-vega-chart');
    assert.strictEqual(A2uiVegaChartV1.element, A2uiVegaChartElement);
    const catalog = createVegaChartV1Catalog();
    assert.strictEqual(catalog.id, VEGACHART_V1_CATALOG_ID);
    assert.strictEqual(catalog.components.has('VegaChart'), true);
  });
});
