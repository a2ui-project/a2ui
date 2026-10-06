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

import * as assert from 'node:assert';
import {describe, it, before, after, afterEach} from 'node:test';
import {z} from 'zod';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../../test/dom-setup.js';
import {
  ComponentContext,
  DataContext,
  MessageProcessor,
  Catalog,
  GenericBinder,
  A2uiExpressionError,
  PayloadValidator,
  getValue,
} from '../../../v1_0/index.js';
import {
  type A2uiWebComponentElement,
  registerUniversalElement,
  A2uiLitElement,
  type WebComponentImplementation,
} from '../../../universal/index.js';
import {html, nothing} from 'lit';
import {SliderApi} from './index.js';

describe('v1.0 Basic Catalog & Universal Custom Elements', () => {
  let basicCatalog: Catalog<WebComponentImplementation>;
  const cleanupElements: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('./index.js')).basicCatalog;
    basicCatalog.components.forEach(c => registerUniversalElement(c));
  });

  after(teardownTestDom);

  afterEach(() => {
    while (cleanupElements.length > 0) {
      cleanupElements.pop()?.remove();
    }
  });

  it('exports v1.0 basicCatalog with 18 components and v1.0 protocolVersion', () => {
    assert.strictEqual(
      basicCatalog.id,
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    );
    assert.strictEqual(basicCatalog.protocolVersion, '1.0');
    assert.strictEqual(basicCatalog.components.size, 18);
  });

  it('selects v1.0 basicCatalog by default when createSurface omits catalogId and preserves metadata', () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's-default',
          metadata: {extensions: {vendor_ext: {enabled: true}}},
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-default',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello v1.0',
              accessibility: {
                label: 'Greeting label',
                description: 'Greeting description',
                live: 'polite',
                hidden: false,
              },
              metadata: {
                extensions: {a2ui_trace: {step: 1}},
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-default')!;
    assert.notStrictEqual(surface, undefined);
    assert.strictEqual(surface.defaultCatalog.id, basicCatalog.id);
    assert.deepStrictEqual(surface.metadata, {extensions: {vendor_ext: {enabled: true}}});

    const comp = surface.componentsModel.get('root')!;
    assert.deepStrictEqual(comp.metadata, {extensions: {a2ui_trace: {step: 1}}});
    assert.strictEqual('metadata' in comp.properties, false);
    assert.strictEqual('catalogId' in comp.properties, false);
  });

  it('PayloadValidator accepts accessibility and metadata on strict v1.0 component schemas', () => {
    const validator = new PayloadValidator(basicCatalog);
    assert.doesNotThrow(() => {
      validator.validateComponent({
        id: 'btn1',
        component: 'Button',
        child: 'txt1',
        action: {event: {name: 'submit'}},
        accessibility: {
          label: {'@path': '/btnLabel'},
          live: 'assertive',
        },
        metadata: {
          extensions: {custom_ext: 'ok'},
        },
      });
    });
  });

  it('applies accessibility attributes (aria-label, aria-description, aria-live, aria-hidden) on BasicCatalogA2uiLitElement', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-a11y', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's-a11y',
          path: '/a11yLabel',
          value: 'Dynamic Accessible Label',
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-a11y',
          components: [
            {
              id: 'txt1',
              component: 'Text',
              text: 'Content',
              accessibility: {
                label: {'@path': '/a11yLabel'},
                description: 'Extra description',
                live: 'polite',
                hidden: true,
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-a11y')!;
    const el = document.createElement('a2ui-basic-text') as A2uiWebComponentElement;
    cleanupElements.push(el);
    document.body.appendChild(el);

    await asyncUpdate(el, e => {
      e.context = new ComponentContext(surface, 'txt1');
    });

    assert.strictEqual(el.getAttribute('aria-label'), 'Dynamic Accessible Label');
    assert.strictEqual(el.getAttribute('aria-description'), 'Extra description');
    assert.strictEqual(el.getAttribute('aria-live'), 'polite');
    assert.strictEqual(el.getAttribute('aria-hidden'), 'true');

    // Verify subsequent reactive data model updates propagate to host attributes
    processor.processMessages([
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's-a11y',
          path: '/a11yLabel',
          value: 'Updated Accessible Label',
        },
      },
    ]);
    await (el as any).updateComplete;
    assert.strictEqual(el.getAttribute('aria-label'), 'Updated Accessible Label');
  });

  it('renders TextField placeholder, Video posterUrl, and Slider steps in v1.0 basicCatalog', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-props', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-props',
          components: [
            {
              id: 'tf1',
              component: 'TextField',
              label: 'Email',
              placeholder: 'user@example.com',
              value: '',
            },
            {
              id: 'vid1',
              component: 'Video',
              url: 'https://example.com/movie.mp4',
              posterUrl: 'https://example.com/poster.jpg',
            },
            {
              id: 'slider1',
              component: 'Slider',
              label: 'Rating',
              min: 0,
              max: 100,
              steps: 5,
              value: 20,
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-props')!;

    const tfEl = document.createElement('a2ui-basic-textfield') as A2uiWebComponentElement;
    cleanupElements.push(tfEl);
    document.body.appendChild(tfEl);
    await asyncUpdate(tfEl, e => {
      e.context = new ComponentContext(surface, 'tf1');
    });
    const tfInput = tfEl.querySelector('input') as HTMLInputElement;
    assert.strictEqual(tfInput.getAttribute('placeholder'), 'user@example.com');

    const vidEl = document.createElement('a2ui-video') as A2uiWebComponentElement;
    cleanupElements.push(vidEl);
    document.body.appendChild(vidEl);
    await asyncUpdate(vidEl, e => {
      e.context = new ComponentContext(surface, 'vid1');
    });
    const videoTag = vidEl.querySelector('video') as HTMLVideoElement;
    assert.strictEqual(videoTag.getAttribute('poster'), 'https://example.com/poster.jpg');

    const sliderEl = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    cleanupElements.push(sliderEl);
    document.body.appendChild(sliderEl);
    await asyncUpdate(sliderEl, e => {
      e.context = new ComponentContext(surface, 'slider1');
    });
    const rangeInput = sliderEl.querySelector('input[type="range"]') as HTMLInputElement;
    assert.strictEqual(rangeInput.getAttribute('step'), '20');
  });

  it('evaluates v1.0 Checkable validationResults (severity and code) on Slider, ChoicePicker, and DateTimeInput', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-checks', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's-checks',
          path: '/warningResult',
          value: {
            valid: false,
            message: 'Soft warning only',
            severity: 'warning',
            code: 'WARN_SOFT',
          },
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-checks',
          components: [
            {
              id: 'slider_check',
              component: 'Slider',
              label: 'Score',
              min: 0,
              max: 100,
              value: 5,
              checks: [
                {
                  condition: {
                    '@call': 'numeric',
                    args: {value: 5, min: 10},
                  },
                },
              ],
            },
            {
              id: 'cp_check',
              component: 'ChoicePicker',
              label: 'Pick one',
              options: [{label: 'A', value: 'a'}],
              value: [],
              checks: [
                {
                  condition: {
                    '@call': 'required',
                    args: {value: []},
                  },
                },
                {
                  condition: {'@path': '/warningResult'},
                },
              ],
            },
            {
              id: 'dt_check',
              component: 'DateTimeInput',
              label: 'Date',
              value: '',
              checks: [
                {
                  condition: {
                    '@call': 'required',
                    args: {value: ''},
                  },
                },
              ],
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-checks')!;

    // Verify GenericBinder preserves severity & code and only counts errors for isValid
    const cpCtx = new ComponentContext(surface, 'cp_check');
    const cpBinder = new GenericBinder<any>(
      cpCtx,
      basicCatalog.components.get('ChoicePicker')!.schema,
    );
    assert.strictEqual(cpBinder.snapshot.isValid, false);
    assert.deepStrictEqual(cpBinder.snapshot.validationErrors, ['This field is required.']);
    assert.strictEqual(cpBinder.snapshot.validationResults.length, 2);
    assert.deepStrictEqual(cpBinder.snapshot.validationResults[1], {
      valid: false,
      message: 'Soft warning only',
      severity: 'warning',
      code: 'WARN_SOFT',
    });
    cpBinder.dispose();

    // Verify Slider, ChoicePicker, DateTimeInput render validationErrors
    const sliderEl = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    cleanupElements.push(sliderEl);
    document.body.appendChild(sliderEl);
    await asyncUpdate(sliderEl, e => {
      e.context = new ComponentContext(surface, 'slider_check');
    });
    assert.strictEqual(
      sliderEl.querySelector('.a2ui-error-message')?.textContent?.trim(),
      'Minimum value is 10.',
    );

    const cpEl = document.createElement('a2ui-choicepicker') as A2uiWebComponentElement;
    cleanupElements.push(cpEl);
    document.body.appendChild(cpEl);
    await asyncUpdate(cpEl, e => {
      e.context = new ComponentContext(surface, 'cp_check');
    });
    assert.strictEqual(
      cpEl.querySelector('.a2ui-error-message')?.textContent?.trim(),
      'This field is required.',
    );

    const dtEl = document.createElement('a2ui-datetimeinput') as A2uiWebComponentElement;
    cleanupElements.push(dtEl);
    document.body.appendChild(dtEl);
    await asyncUpdate(dtEl, e => {
      e.context = new ComponentContext(surface, 'dt_check');
    });
    assert.strictEqual(
      dtEl.querySelector('.a2ui-error-message')?.textContent?.trim(),
      'This field is required.',
    );
  });

  it('enforces requiresUserActivation on openUrl: blocks passive property binding and allows action invocation', () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-act', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-act',
          components: [
            {
              id: 'btn1',
              component: 'Button',
              child: 'txt1',
              action: {
                functionCall: {
                  '@call': 'openUrl',
                  args: {url: 'https://example.com'},
                },
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-act')!;
    const btnCtx = new ComponentContext(surface, 'btn1');

    // 1. Passive signal evaluation of openUrl must fail with EXPRESSION_ERROR
    const errors: Array<{code: string; message: string; expression?: string}> = [];
    const sub = surface.onError.subscribe(err => {
      errors.push(err);
    });
    const sig = btnCtx.dataContext.resolveSignal({
      '@call': 'openUrl',
      args: {url: 'https://example.com'},
    });
    assert.strictEqual(getValue(sig), undefined);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /requires user activation/);
    sub.unsubscribe();

    // Direct invoker call with a passive context throws A2uiExpressionError
    assert.throws(
      () =>
        basicCatalog.invoker('openUrl', {url: 'https://example.com'}, {
          isPassiveEvaluation: true,
        } as any),
      (err: unknown) =>
        err instanceof A2uiExpressionError && /requires user activation/.test(err.message),
    );

    // 2. Action invocation via GenericBinder.bindAction succeeds when user-activated
    let openedUrl: string | undefined;
    const origOpen = window.open;
    window.open = ((url: string) => {
      openedUrl = url;
      return null;
    }) as any;
    try {
      const binder = new GenericBinder<any>(btnCtx, basicCatalog.components.get('Button')!.schema);
      binder.snapshot.action();
      assert.strictEqual(openedUrl, 'https://example.com/');
      binder.dispose();
    } finally {
      window.open = origOpen;
    }
  });

  it('blocks requiresUserActivation function in passive bindings even during synchronous action mutation', () => {
    let openedUrl: string | undefined;
    const origOpen = window.open;
    window.open = ((url: string) => {
      openedUrl = url;
      return null;
    }) as any;

    try {
      const mutateDataApi = {
        name: 'mutateData',
        returnType: 'boolean' as const,
        schema: z.object({url: z.string()}),
        execute: (args: Record<string, unknown>, ctx: any) => {
          ctx.dataModel.set('/targetUrl', args.url);
          return true;
        },
      };

      const testCatalog = new Catalog(
        'https://example.com/test_cat.json',
        '1.0',
        Array.from(basicCatalog.components.values()),
        [...(Array.from(basicCatalog.functions.values()) as any[]), mutateDataApi as any],
      );

      const processor = new MessageProcessor([testCatalog as any]);
      processor.processMessages([
        {
          version: 'v1.0',
          createSurface: {surfaceId: 's-leak', catalogId: testCatalog.id},
        },
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 's-leak', path: '/targetUrl', value: 'https://initial.com'},
        },
      ]);
      const surface = processor.model.getSurface('s-leak')!;
      const dataCtx = new DataContext(surface, '/');

      // Create a passive subscription to openUrl depending on /targetUrl
      const errors: Array<{code: string; message: string}> = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });

      const passiveSub = dataCtx.subscribeDynamicValue<unknown>(
        {
          '@call': 'openUrl',
          args: {url: {'@path': '/targetUrl'}},
        },
        () => {},
      );

      assert.strictEqual(passiveSub.value, undefined);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(openedUrl, undefined);

      // Invoke a user-activated function that mutates /targetUrl synchronously
      dataCtx.resolveDynamicValue(
        {
          '@call': 'mutateData',
          args: {url: 'https://malicious.com'},
        },
        0,
        true, // userActivated = true
      );

      // Verify that openUrl was NOT executed during the reactive re-evaluation
      assert.strictEqual(openedUrl, undefined);
      passiveSub.unsubscribe();
    } finally {
      window.open = origOpen;
    }
  });

  it('evaluates @index on any v1.0 catalog even without explicit IndexImplementation registration', () => {
    const customV1Catalog = new Catalog(
      'https://example.com/custom_v1.json',
      '1.0',
      [
        {
          name: 'CustomItem',
          schema: z.object({indexNum: z.number()}).strict(),
        },
      ],
      [],
    );

    const processor = new MessageProcessor([customV1Catalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-idx', catalogId: customV1Catalog.id},
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's-idx',
          path: '/items',
          value: [{name: 'First'}, {name: 'Second'}],
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-idx',
          components: [{id: 'item1', component: 'CustomItem', indexNum: 0}],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-idx')!;
    const sig = new ComponentContext(surface, 'item1', '/items/1').dataContext.resolveSignal({
      '@call': '@index',
      args: {offset: 1},
    });

    assert.strictEqual(getValue(sig), 2);
  });

  it('renders child components from a secondary catalog via renderNode', async () => {
    class CustomBadgeElement extends A2uiLitElement<any> {
      protected override readonly api = {
        name: 'Badge',
        schema: z.object({title: z.string()}).strict(),
      };
      override createRenderRoot() {
        return this;
      }
      override render() {
        const props = this.controller?.props;
        if (!props) return nothing;
        return html`<span class="custom-badge">${props.title}</span>`;
      }
    }
    const CustomBadgeImpl: WebComponentImplementation = {
      name: 'Badge',
      schema: z.object({title: z.string()}).strict(),
      tagName: 'a2ui-test-custom-badge',
      element: CustomBadgeElement,
    };
    registerUniversalElement(CustomBadgeImpl);

    const secondaryCatalog = new Catalog<WebComponentImplementation>(
      'https://example.com/secondary_v1.json',
      '1.0',
      [CustomBadgeImpl],
      [],
    );

    const processor = new MessageProcessor([basicCatalog, secondaryCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 's-multi', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's-multi',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['badge1'],
            },
            {
              id: 'badge1',
              component: 'Badge',
              catalogId: secondaryCatalog.id,
              title: 'Cross-Catalog Child',
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-multi')!;
    const colEl = document.createElement('a2ui-basic-column') as A2uiWebComponentElement;
    cleanupElements.push(colEl);
    document.body.appendChild(colEl);

    await asyncUpdate(colEl, e => {
      e.context = new ComponentContext(surface, 'root');
    });
    const badgeEl = colEl.querySelector('a2ui-test-custom-badge') as A2uiWebComponentElement;
    assert.notStrictEqual(badgeEl, null);
    await (badgeEl as any).updateComplete;

    assert.strictEqual(
      badgeEl.querySelector('.custom-badge')?.textContent?.trim(),
      'Cross-Catalog Child',
    );
  });

  it('SliderApi v1.0 schema accepts steps property and omits step attribute when max <= min', async () => {
    const result = SliderApi.schema.safeParse({
      max: 100,
      steps: 10,
      value: 50,
    });
    assert.strictEqual(result.success, true);

    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {surfaceId: 'sSliderBounds', catalogId: basicCatalog.id},
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 'sSliderBounds',
          components: [
            {
              id: 'sliderEq',
              component: 'Slider',
              min: 50,
              max: 50,
              steps: 5,
              value: 50,
            },
            {
              id: 'sliderZeroSteps',
              component: 'Slider',
              min: 0,
              max: 1,
              steps: 0,
              value: 0,
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('sSliderBounds')!;
    const sliderEl = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    cleanupElements.push(sliderEl);
    document.body.appendChild(sliderEl);

    await asyncUpdate(sliderEl, e => {
      e.context = new ComponentContext(surface, 'sliderEq');
    });

    const inputEl = sliderEl.querySelector('input[type="range"]') as HTMLInputElement;
    assert.strictEqual(inputEl.hasAttribute('step'), false);

    const zeroStepsEl = document.createElement('a2ui-slider') as A2uiWebComponentElement;
    cleanupElements.push(zeroStepsEl);
    document.body.appendChild(zeroStepsEl);
    await asyncUpdate(zeroStepsEl, e => {
      e.context = new ComponentContext(surface, 'sliderZeroSteps');
    });
    const zeroStepsInput = zeroStepsEl.querySelector('input[type="range"]') as HTMLInputElement;
    assert.strictEqual(zeroStepsInput.hasAttribute('step'), false);
  });

  it('extractFunctionDefinition preserves first argsSchema in allOf while scanning requiresUserActivation', async () => {
    const modulePath = '../../../../../scripts/generate-catalog-schemas.mjs';
    const {extractFunctionDefinition} = (await import(modulePath)) as {
      extractFunctionDefinition: (
        funcName: string,
        funcDef: Record<string, unknown>,
      ) => {
        argsProps: Record<string, unknown>;
        requiresUserActivation: boolean;
      };
    };

    const extracted = extractFunctionDefinition('testFn', {
      allOf: [
        {
          properties: {
            args: {
              type: 'object',
              properties: {firstArg: {type: 'string'}},
              required: ['firstArg'],
            },
          },
        },
        {
          properties: {
            args: {
              type: 'object',
              properties: {secondArg: {type: 'number'}},
            },
            requiresUserActivation: {const: true},
          },
        },
      ],
    });

    assert.deepStrictEqual(Object.keys(extracted.argsProps), ['firstArg']);
    assert.strictEqual(extracted.requiresUserActivation, true);
  });

  it('handles undefined navigator.userActivation without throwing TypeError', () => {
    const originalNavigator = globalThis.navigator;
    const origOpen = window.open;
    Object.defineProperty(globalThis, 'navigator', {
      value: {userActivation: undefined},
      configurable: true,
    });
    window.open = (() => null) as any;

    try {
      assert.throws(
        () =>
          basicCatalog.invoker('openUrl', {url: 'https://a2ui.org'}, {
            isPassiveEvaluation: true,
          } as any),
        (err: unknown) =>
          err instanceof A2uiExpressionError && /requires user activation/.test(err.message),
      );

      assert.doesNotThrow(() =>
        basicCatalog.invoker('openUrl', {url: 'https://a2ui.org'}, {
          isUserActivated: false,
        } as any),
      );
    } finally {
      window.open = origOpen;
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });
});
