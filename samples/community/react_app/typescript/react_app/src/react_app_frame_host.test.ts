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

import {
  basicCatalog,
  Catalog,
  ComponentContext,
  MessageProcessor,
  type FunctionApi,
  type SurfaceModel,
} from '@a2ui/web_core/v1_0';
import {z} from 'zod';
import {REACT_APP_CATALOG_ID, reactAppCatalog} from './catalog.js';
import {ReactAppFrameHost} from './react_app_frame_host.js';
import {ComponentContextFrameHost} from './shared/sandbox/component_context_frame_host.js';

const DEMO_CATALOG_ID = 'https://example.com/demo/v1/catalog.json';
const SURFACE_ID = 'trip';

/** An agent function: declared in the demo catalog without an implementation. */
const estimateTravelTime: FunctionApi = {
  name: 'estimateTravelTime',
  returnType: 'number',
  schema: z.object({stops: z.array(z.string())}),
};

// `Catalog` accepts schema-only functions; its type parameter defaults to implemented ones.
const demoCatalog = new Catalog(
  DEMO_CATALOG_ID,
  '1.0',
  [],
  [estimateTravelTime],
) as unknown as Catalog<never>;

interface AgentCall {
  readonly functionCallId: string;
  readonly catalogId: unknown;
  readonly name: unknown;
  readonly args: unknown;
}

/** A processor whose outbound listener records `callAgentFunction` messages. */
function createProcessor(defaultCatalogId: string | undefined) {
  const calls: AgentCall[] = [];
  const processor = new MessageProcessor([basicCatalog, reactAppCatalog, demoCatalog], undefined, {
    outboundListener: message => {
      if ('callAgentFunction' in message) {
        const {functionCallId, callFunction} = message.callAgentFunction as unknown as {
          functionCallId: string;
          callFunction: Record<string, unknown>;
        };
        calls.push({
          functionCallId,
          catalogId: callFunction['catalogId'],
          name: callFunction['@call'],
          args: callFunction['args'],
        });
      }
    },
  });
  processor.processMessages([
    {
      version: '1.0',
      createSurface: {
        surfaceId: SURFACE_ID,
        ...(defaultCatalogId ? {catalogId: defaultCatalogId} : {}),
      },
    } as never,
    {
      version: '1.0',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {
            id: 'root',
            component: 'ReactApp',
            catalogId: REACT_APP_CATALOG_ID,
            source: 'export default function App() { return null; }',
          },
        ],
      },
    } as never,
  ]);
  const surface = processor.model.getSurface(SURFACE_ID) as SurfaceModel;
  const context = new ComponentContext(surface, 'root');
  return {processor, surface, context, calls};
}

function answer(processor: MessageProcessor, functionCallId: string, value: unknown) {
  processor.processMessages([
    {version: '1.0', agentFunctionResponse: {functionCallId, value}} as never,
  ]);
}

describe('ReactAppFrameHost function routing', () => {
  describe('on a surface with several catalogs and no default catalog (Express output)', () => {
    let setup: ReturnType<typeof createProcessor>;

    beforeEach(() => {
      setup = createProcessor(undefined);
    });

    afterEach(() => {
      setup.surface.dispose();
    });

    it('runs a local function of another catalog, where the shared host throws', () => {
      const host = new ReactAppFrameHost(setup.context);
      const shared = new ComponentContextFrameHost(setup.context);

      const formatted = host.invokeFunction('formatCurrency', {value: 1200, currency: 'USD'});

      expect(formatted).toContain('1,200');
      expect(() =>
        shared.invokeFunction('formatCurrency', {value: 1200, currency: 'USD'}),
      ).toThrowError(/no default catalogId/);
    });

    it('routes an agent function declared in a third catalog to callAgentFunction under that catalog', async () => {
      const host = new ReactAppFrameHost(setup.context);

      const pending = host.invokeFunction('estimateTravelTime', {stops: ['louvre', 'eiffel']});
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(setup.calls.map(({catalogId, name, args}) => ({catalogId, name, args}))).toEqual([
        {
          catalogId: DEMO_CATALOG_ID,
          name: 'estimateTravelTime',
          args: {stops: ['louvre', 'eiffel']},
        },
      ]);
      answer(setup.processor, setup.calls[0].functionCallId, 74);
      expect(await (pending as Promise<unknown>)).toBe(74);
    });

    it('routes an undeclared function to the agent under the ReactApp catalog', async () => {
      const host = new ReactAppFrameHost(setup.context);

      const pending = host.invokeFunction('querySales', {region: 'EMEA'});
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(setup.calls.map(({catalogId, name}) => ({catalogId, name}))).toEqual([
        {catalogId: REACT_APP_CATALOG_ID, name: 'querySales'},
      ]);
      answer(setup.processor, setup.calls[0].functionCallId, [{id: 1}]);
      expect(await (pending as Promise<unknown>)).toEqual([{id: 1}]);
    });

    it('validates the arguments of a declared agent function before sending it', () => {
      const host = new ReactAppFrameHost(setup.context);

      expect(() => host.invokeFunction('estimateTravelTime', {stops: 'not a list'})).toThrowError(
        /Validation failed/,
      );
      expect(setup.calls).toEqual([]);
    });
  });

  describe('on a surface with a default catalog', () => {
    it('routes an agent function of a third catalog under that catalog, not the default', async () => {
      const setup = createProcessor(basicCatalog.id);
      const host = new ReactAppFrameHost(setup.context);
      const shared = new ComponentContextFrameHost(setup.context);

      const pending = host.invokeFunction('estimateTravelTime', {stops: ['a']});
      const sharedPending = shared.invokeFunction('estimateTravelTime', {stops: ['a']});
      await new Promise(resolve => setTimeout(resolve, 0));

      // The shared host sends the call under the default (basic) catalog instead.
      expect(setup.calls.map(call => call.catalogId)).toEqual([DEMO_CATALOG_ID, basicCatalog.id]);
      answer(setup.processor, setup.calls[0].functionCallId, 12);
      answer(setup.processor, setup.calls[1].functionCallId, 12);
      expect(await (pending as Promise<unknown>)).toBe(12);
      await sharedPending;
      expect(host.invokeFunction('formatCurrency', {value: 5, currency: 'USD'})).toContain('5');
      setup.surface.dispose();
    });
  });
});
