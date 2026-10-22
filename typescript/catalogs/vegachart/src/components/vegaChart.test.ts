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

import {FakeResizeObserver, latestResizeObserver, mockRect, settle} from '../test/dom.js';

import * as assert from 'node:assert';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  ComponentContext,
  ComponentModel,
  registerUniversalElement,
  SurfaceModel,
} from '@a2ui/web_core/v1_0';

import {A2uiVegaChart, vegachartCatalog} from '../v0_9/index.js';
import {
  A2uiVegaChartElement,
  DEFAULT_HEIGHT,
  FALLBACK_WIDTH_PX,
  transformSpec,
  type VegaEmbedFn,
} from './vegaChart.js';

registerUniversalElement(A2uiVegaChart);

type Spec = Record<string, unknown>;
const axisOf = (result: Spec, channel: string) =>
  ((result['encoding'] as Spec)[channel] as Spec)['axis'] as Spec;

describe('transformSpec', () => {
  describe('standard charts', () => {
    it('sets default config, autosize fit, and container dimensions', () => {
      const result = transformSpec({mark: 'bar'}, 300, 500);
      assert.deepStrictEqual(result['autosize'], {type: 'fit', contains: 'padding'});
      assert.strictEqual(result['height'], 300);
      assert.strictEqual(result['width'], 500);
      assert.strictEqual((result['config'] as Spec)['background'], 'transparent');
    });

    it('falls back to "container" width and the default height', () => {
      const result = transformSpec({mark: 'line'});
      assert.strictEqual(result['height'], DEFAULT_HEIGHT);
      assert.strictEqual(result['width'], 'container');
    });

    it('preserves user config while merging defaults', () => {
      const result = transformSpec({
        mark: 'point',
        config: {background: 'white', axis: {labelColor: 'red'}, view: {stroke: 'black'}},
      });
      const config = result['config'] as Spec;
      assert.strictEqual(config['background'], 'white');
      assert.strictEqual((config['axis'] as Spec)['labelColor'], 'red');
      assert.strictEqual((config['axis'] as Spec)['titleColor'], '#202124');
      assert.strictEqual((config['view'] as Spec)['stroke'], 'black');
    });

    it('does not mutate the input spec', () => {
      const input = {mark: 'line', encoding: {x: {type: 'temporal', axis: {format: '%b'}}}};
      transformSpec(input);
      assert.strictEqual(input.encoding.x.axis.format, '%b');
    });
  });

  describe('faceted charts', () => {
    it('sizes encoding.facet subplots from a nominal y-axis with bar marks', () => {
      const result = transformSpec(
        {
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
        },
        300,
        800,
      );
      assert.deepStrictEqual(result['autosize'], {type: 'pad'});
      // 3 items in facet A × 25px = 75 → max(100, 75) = 100.
      assert.strictEqual(result['height'], 100);
      // 2 columns; (800 − 2 × 60) / 2 = 340.
      assert.strictEqual(result['width'], 340);
    });

    it('sizes encoding.column subplots from an ordinal x-axis with point marks', () => {
      const values = ['X1', 'X2', 'X3', 'X4', 'X5'].map((xVal, i) => ({col: 'C1', xVal, yVal: i}));
      const result = transformSpec(
        {
          data: {values},
          mark: {type: 'point'},
          encoding: {
            column: {field: 'col'},
            x: {field: 'xVal', type: 'ordinal'},
            y: {field: 'yVal', type: 'quantitative'},
          },
        },
        300,
        600,
      );
      // 5 items × 40px = 200 → max(150, 200) = 200.
      assert.strictEqual(result['width'], 200);
      assert.strictEqual(result['height'], 200);
    });

    it('moves width/height into the inner spec for the top-level facet operator', () => {
      const result = transformSpec(
        {
          data: {name: 'myData'},
          datasets: {
            myData: [
              {r: 'R1', x: 1, y: 2},
              {r: 'R2', x: 3, y: 4},
            ],
          },
          facet: {row: {field: 'r'}},
          spec: {
            mark: 'line',
            encoding: {
              x: {field: 'x', type: 'quantitative'},
              y: {field: 'y', type: 'quantitative'},
            },
          },
          width: 500,
          height: 500,
        },
        300,
        400,
      );
      assert.strictEqual(result['width'], undefined);
      assert.strictEqual(result['height'], undefined);
      assert.strictEqual((result['spec'] as Spec)['height'], 200);
      assert.strictEqual((result['spec'] as Spec)['width'], 340);
    });
  });

  describe('temporal axis formatting', () => {
    it('adds %Y and a -45° label angle to a %b format', () => {
      const result = transformSpec({
        mark: 'line',
        encoding: {x: {field: 'date', type: 'temporal', axis: {format: '%b'}}},
      });
      assert.strictEqual(axisOf(result, 'x')['format'], '%b %Y');
      assert.strictEqual(axisOf(result, 'x')['labelAngle'], -45);
    });

    it('keeps formats that already contain %Y and existing label angles', () => {
      const result = transformSpec({
        mark: 'line',
        encoding: {
          x: {field: 'date', type: 'temporal', axis: {format: '%b %Y', labelAngle: 0}},
          y: {field: 'date2', timeUnit: 'yearmonth', axis: {format: '%b', labelAngle: 30}},
        },
      });
      assert.strictEqual(axisOf(result, 'x')['format'], '%b %Y');
      assert.strictEqual(axisOf(result, 'x')['labelAngle'], 0);
      assert.strictEqual(axisOf(result, 'y')['format'], '%b %Y');
      assert.strictEqual(axisOf(result, 'y')['labelAngle'], 30);
    });

    it('recurses into layer and nested spec', () => {
      const result = transformSpec({
        layer: [{encoding: {x: {field: 'date', type: 'temporal', axis: {format: '%b %d'}}}}],
        spec: {encoding: {y: {field: 'month', timeUnit: 'month', axis: {format: '%b'}}}},
      });
      const layer0 = (result['layer'] as Spec[])[0];
      assert.strictEqual(axisOf(layer0, 'x')['format'], '%b %Y %d');
      assert.strictEqual(axisOf(result['spec'] as Spec, 'y')['format'], '%b %Y');
    });
  });
});

describe('A2uiVegaChartElement', () => {
  let host: HTMLElement;
  const originalDefaultEmbedFn = A2uiVegaChartElement.defaultEmbedFn;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    A2uiVegaChartElement.defaultEmbedFn = originalDefaultEmbedFn;
  });

  /** Mounts a standalone element with a recording embed function. */
  async function mount(spec: Spec, embedFn?: VegaEmbedFn) {
    const rendered: Spec[] = [];
    const el = new A2uiVegaChartElement();
    el.embedFn =
      embedFn ??
      (async (_el, chartSpec) => {
        rendered.push(chartSpec);
        return {};
      });
    el.spec = spec;
    host.appendChild(el);
    await el.updateComplete;
    const container = el.querySelector<HTMLElement>('#chart-container')!;
    return {el, container, rendered};
  }

  it('renders a spec bound through an A2UI surface and re-renders on data model updates', async () => {
    const rendered: Spec[] = [];
    let finalized = 0;
    A2uiVegaChartElement.defaultEmbedFn = async (el, chartSpec) => {
      rendered.push(chartSpec);
      el.appendChild(document.createElement('iframe'));
      return {finalize: () => finalized++};
    };

    const surface = new SurfaceModel('surface-1', vegachartCatalog);
    surface.dataModel.set('/chartSpec', {description: 'Revenue chart', mark: 'bar'});
    surface.componentsModel.addComponent(
      new ComponentModel(
        'chart-1',
        'VegaChart',
        {spec: {path: '/chartSpec'}, height: 340},
        vegachartCatalog,
      ),
    );

    const el = new A2uiVegaChartElement();
    el.context = new ComponentContext(surface, 'chart-1');
    host.appendChild(el);
    await el.updateComplete;

    const container = el.querySelector<HTMLElement>('#chart-container')!;
    mockRect(container, 640, 340);
    latestResizeObserver()?.trigger(640, 340);
    await settle();

    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(rendered[0]['width'], 640);
    assert.strictEqual(rendered[0]['height'], 340);
    const iframe = el.querySelector('iframe')!;
    assert.strictEqual(iframe.getAttribute('title'), 'Revenue chart');
    assert.strictEqual(iframe.style.height, '340px');

    surface.dataModel.set('/chartSpec', {description: 'Updated', mark: 'line'});
    await el.updateComplete;
    await settle();

    assert.strictEqual(rendered.length, 2);
    assert.strictEqual(rendered[1]['mark'], 'line');
    assert.strictEqual(finalized, 1, 'previous view is finalized before re-render');
  });

  it('uses FALLBACK_WIDTH_PX when the container stays at width 0, then re-renders on resize', async () => {
    const {el, container, rendered} = await mount({mark: 'bar'});
    mockRect(container, 0, 290);
    mockRect(el, 0, 290, true);
    await settle();

    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(rendered[0]['width'], FALLBACK_WIDTH_PX);
    assert.strictEqual(el.style.width, `${FALLBACK_WIDTH_PX}px`);

    latestResizeObserver()?.trigger(720, 290);
    await settle();

    assert.strictEqual(rendered.length, 2);
    assert.strictEqual(rendered[1]['width'], 720);
    assert.strictEqual(el.style.width, '');
    assert.strictEqual(container.style.width, '100%');
  });

  it('does not render inside a display:none subtree', async () => {
    const {el, container, rendered} = await mount({mark: 'bar'});
    mockRect(container, 0, 0);
    mockRect(el, 0, 0, false);
    await settle();
    assert.strictEqual(rendered.length, 0);
  });

  it('removes the chart and finalizes the view when spec is cleared', async () => {
    let finalized = 0;
    const {el, container} = await mount({mark: 'bar'}, async target => {
      target.appendChild(document.createElement('svg'));
      return {finalize: () => finalized++};
    });
    mockRect(container, 500, 290);
    latestResizeObserver()?.trigger(500, 290);
    await settle();
    assert.ok(container.querySelector('svg'), 'chart is rendered');

    el.spec = undefined;
    await el.updateComplete;
    await settle();

    assert.strictEqual(container.querySelector('svg'), null, 'stale chart is removed');
    assert.strictEqual(finalized, 1);
  });

  it('keeps a late-resolving stale embed out of the container', async () => {
    let resolveFirst!: () => void;
    let calls = 0;
    const {el, container} = await mount({mark: 'bar'}, target => {
      calls++;
      if (calls === 1) {
        return new Promise(res => {
          resolveFirst = () => {
            target.appendChild(document.createElement('svg'));
            res({});
          };
        });
      }
      target.appendChild(document.createElement('svg'));
      return Promise.resolve({});
    });
    mockRect(container, 500, 290);
    latestResizeObserver()?.trigger(500, 290);

    el.spec = {mark: 'line'};
    await el.updateComplete;
    await settle();
    resolveFirst();
    await settle();

    assert.strictEqual(container.querySelectorAll('svg').length, 1, 'only the active chart');
  });

  it('preserves a consumer-set inline host width', async () => {
    const {el, container} = await mount({mark: 'bar'});
    el.style.width = '50%';
    mockRect(container, 500, 290);
    latestResizeObserver()?.trigger(500, 290);
    await settle();
    assert.strictEqual(el.style.width, '50%');
  });

  it('grows the container to fit a faceted chart instead of scrolling it', async () => {
    const values = ['A', 'B', 'C', 'D'].flatMap(team =>
      ['P0', 'P1', 'P2'].map(priority => ({team, priority, n: 1})),
    );
    const {container, rendered} = await mount({
      data: {values},
      mark: 'bar',
      encoding: {
        facet: {field: 'team', columns: 2},
        x: {field: 'priority', type: 'ordinal'},
        y: {field: 'n', type: 'quantitative'},
      },
    });
    mockRect(container, 600, 290);
    latestResizeObserver()?.trigger(600, 290);
    await settle();

    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(container.style.height, 'auto');
    assert.strictEqual(container.style.overflowY, 'hidden');
    // Two rows of subplots need more than the default 290px.
    assert.ok(parseInt(container.style.minHeight, 10) > DEFAULT_HEIGHT);
  });

  it('finalizes a stale embed when the spec changes mid-render', async () => {
    let resolveFirst!: (res: {finalize: () => void}) => void;
    let firstFinalized = false;
    let secondFinalized = false;
    let calls = 0;
    const {el, container} = await mount({mark: 'bar'}, () => {
      calls++;
      if (calls === 1) {
        return new Promise(res => (resolveFirst = res));
      }
      return Promise.resolve({finalize: () => (secondFinalized = true)});
    });
    mockRect(container, 500, 290);
    latestResizeObserver()?.trigger(500, 290);

    el.spec = {mark: 'line'};
    await el.updateComplete;
    await settle();
    resolveFirst({finalize: () => (firstFinalized = true)});
    await settle();

    assert.strictEqual(firstFinalized, true, 'stale result is finalized');
    assert.strictEqual(secondFinalized, false, 'active result stays alive');

    el.remove();
    assert.strictEqual(secondFinalized, true, 'disconnect finalizes the active view');
  });
});
