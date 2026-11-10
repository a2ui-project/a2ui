/*
 * Copyright 2026 Google LLC
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

/**
 * Fixture page: one surface rendered by @a2ui/react with native components and a hard-coded
 * ReactApp, a mocked agent for agent functions, and hooks the Playwright test reads on `window`.
 */

import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import {
  basicCatalog,
  Catalog,
  MessageProcessor,
  type FunctionApi,
  type SurfaceModel,
} from '@a2ui/web_core/v1_0';
import {createRoot} from 'react-dom/client';
import {z} from 'zod';
import lapTimerExample from '../../../../catalog/v1/examples/lap_timer.json' with {type: 'json'};
import loanExplorerExample from '../../../../catalog/v1/examples/loan_explorer.json' with {type: 'json'};
import {configureReactApp, REACT_APP_CATALOG_ID, reactAppCatalog} from '../../src/index.js';

/** Catalog examples the page can render instead of the fixture, with `?example=<name>`. */
const EXAMPLES: Record<string, {messages: unknown[]}> = {
  lap_timer: lapTimerExample,
  loan_explorer: loanExplorerExample,
};

const DEMO_CATALOG_ID = 'https://example.com/fixture/demo/v1/catalog.json';
const SURFACE_ID = 'fixture';

/** The app under test: it reads and writes the data model and calls a local and an agent function. */
export const FIXTURE_APP_SOURCE = String.raw`import { useState } from "react";
import { Button, Card, Stack, Text, callFunction, dispatchAction, useData, useFunction } from "a2ui";

export default function App() {
  const [count, setCount] = useData<number>("/fixture/count", 0);
  const [formatted, setFormatted] = useState("");
  const { data: minutes, loading } = useFunction<number>("estimateTravelTime", { stops: ["louvre", "eiffel", "orsay"] });

  return (
    <Card title="Fixture app">
      <Stack gap={2}>
        <Text variant="numeric">Count: <span data-testid="count">{count}</span></Text>
        <Stack direction="horizontal" gap={2}>
          <Button variant="primary" onClick={() => setCount((previous) => previous + 1)}>Increment</Button>
          <Button onClick={async () => setFormatted(await callFunction<string>("formatCurrency", { value: count * 1000, currency: "USD" }))}>
            Format
          </Button>
          <Button onClick={() => dispatchAction("fixtureDone", { count })}>Done</Button>
        </Stack>
        <Text>Formatted: <span data-testid="formatted">{formatted}</span></Text>
        <Text>Travel: <span data-testid="minutes">{loading ? "loading" : String(minutes)}</span></Text>
      </Stack>
    </Card>
  );
}
`;

/** An agent function, declared in a third catalog and answered by the mocked agent below. */
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

interface FixtureHooks {
  processor: MessageProcessor<ReactCatalogComponent>;
  surface: SurfaceModel<ReactCatalogComponent>;
  actions: unknown[];
  agentCalls: unknown[];
  errors: unknown[];
  rendered: Array<{timings: Record<string, number>; frameReadyToRenderedMs: number}>;
  getData(path: string): unknown;
  setDataFromAgent(path: string, value: unknown): void;
}

declare global {
  interface Window {
    fixture: FixtureHooks;
  }
}

const query = new URLSearchParams(location.search);
const runtimeOrigin = query.get('runtime') ?? location.origin;
const example = EXAMPLES[query.get('example') ?? ''];
configureReactApp({runtimeBaseUrl: `${runtimeOrigin}/react-app/v1/`});

const actions: unknown[] = [];
const agentCalls: unknown[] = [];
const processor: MessageProcessor<ReactCatalogComponent> =
  new MessageProcessor<ReactCatalogComponent>(
    [basicCatalog, reactAppCatalog, demoCatalog] as never,
    action => {
      actions.push(action);
    },
    {
      outboundListener: message => {
        if (!('callAgentFunction' in message)) {
          return;
        }
        const call = message.callAgentFunction as unknown as {
          functionCallId: string;
          callFunction: {'@call': string; catalogId: string; args: {stops?: string[]}};
        };
        agentCalls.push(call);
        // The mocked agent answers 25 minutes per stop, after a network-like delay.
        setTimeout(() => {
          processor.processMessages([
            {
              version: '1.0',
              agentFunctionResponse: {
                functionCallId: call.functionCallId,
                value: (call.callFunction.args.stops?.length ?? 0) * 25,
              },
            } as never,
          ]);
        }, 30);
      },
    },
  );

// A defaultless surface with components stamped by catalog, the shape the Express compiler emits.
const fixtureMessages = [
  {version: '1.0', createSurface: {surfaceId: SURFACE_ID}},
  {version: '1.0', updateDataModel: {surfaceId: SURFACE_ID, value: {fixture: {count: 3}}}},
  {
    version: '1.0',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        {
          id: 'root',
          component: 'Column',
          catalogId: basicCatalog.id,
          children: ['native_count', 'native_slider', 'app'],
        },
        {
          id: 'native_count',
          component: 'Text',
          catalogId: basicCatalog.id,
          text: {
            '@call': 'formatString',
            catalogId: basicCatalog.id,
            args: {value: 'Native count: ${/fixture/count}'},
          },
        },
        {
          id: 'native_slider',
          component: 'Slider',
          catalogId: basicCatalog.id,
          label: 'Native slider',
          min: 0,
          max: 50,
          value: {'@path': '/fixture/count'},
        },
        {
          id: 'app',
          component: 'ReactApp',
          catalogId: REACT_APP_CATALOG_ID,
          title: 'Fixture app',
          height: 260,
          dataPaths: ['/fixture'],
          functions: ['formatCurrency', 'estimateTravelTime'],
          source: FIXTURE_APP_SOURCE,
        },
      ],
    },
  },
];
const messages = example ? structuredClone(example.messages) : fixtureMessages;
processor.processMessages(messages as never);

const surfaceId = (messages[0] as {createSurface: {surfaceId: string}}).createSurface.surfaceId;
const surface = processor.model.getSurface(surfaceId) as SurfaceModel<ReactCatalogComponent>;
const errors: unknown[] = [];
const rendered: FixtureHooks['rendered'] = [];
document.addEventListener('react-app-error', event => errors.push((event as CustomEvent).detail));
document.addEventListener('react-app-rendered', event =>
  rendered.push((event as CustomEvent).detail),
);

window.fixture = {
  processor,
  surface,
  actions,
  agentCalls,
  errors,
  rendered,
  getData: path => surface.dataModel.get(path),
  setDataFromAgent: (path, value) =>
    processor.processMessages([
      {version: '1.0', updateDataModel: {surfaceId, path, value}} as never,
    ]),
};

createRoot(document.getElementById('surface')!).render(<A2uiSurface surface={surface} />);
