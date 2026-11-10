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

import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  callFunction,
  dispatchAction,
  setData,
  subscribe,
  useData,
  useFunction,
} from './data_api.js';
import {RuntimeSession, setSession} from './session.js';
import {FakeHost, flush} from './testing/fake_host.js';

function connect(host: FakeHost, snapshot: Record<string, unknown> = {}): RuntimeSession {
  const session = new RuntimeSession(host.createClient());
  session.store.seed(snapshot, Object.keys(snapshot));
  setSession(session);
  return session;
}

describe('a2ui data API', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = new FakeHost();
    host.handlers.set('data/set', params => ({
      result: {seq: params['seq'] as number, value: params['value'] as never},
    }));
    host.handlers.set('data/subscribe', () => ({result: {}}));
  });

  afterEach(() => {
    cleanup();
    setSession(null);
  });

  it('useData renders the snapshot on the first render and follows host changes', async () => {
    connect(host, {'/loan/rate': 5});
    function App() {
      const [rate] = useData<number>('/loan/rate', 1);
      return <p>rate {rate}</p>;
    }

    render(<App />);
    expect(screen.getByText('rate 5')).toBeTruthy();

    act(() => host.notify('data/changed', {path: '/loan/rate', value: 7}));
    expect(screen.getByText('rate 7')).toBeTruthy();
    expect(host.requests('data/subscribe')).toEqual([]);
  });

  it('useData returns the fallback while the path is empty, and subscribes to unknown paths', async () => {
    connect(host);
    host.handlers.set('data/subscribe', () => ({result: {value: 'Ada'}}));
    function App() {
      const [name] = useData<string>('/user/name', 'nobody');
      return <p>hello {name}</p>;
    }

    render(<App />);
    expect(screen.getByText('hello nobody')).toBeTruthy();
    await act(flush);

    expect(screen.getByText('hello Ada')).toBeTruthy();
    expect(host.requests('data/subscribe').map(r => r.params)).toEqual([{path: '/user/name'}]);
  });

  it('the useData setter updates at once and writes to the host, with updater functions', async () => {
    connect(host, {'/count': 1});
    let increment: () => void = () => {};
    function App() {
      const [count, setCount] = useData<number>('/count', 0);
      increment = () => setCount(previous => previous + 1);
      return <p>count {count}</p>;
    }

    render(<App />);
    act(() => increment());
    act(() => increment());

    expect(screen.getByText('count 3')).toBeTruthy();
    expect(host.requests('data/set').map(r => r.params)).toEqual([
      {path: '/count', value: 2, seq: 1},
      {path: '/count', value: 3, seq: 2},
    ]);
    await act(flush);
    expect(screen.getByText('count 3')).toBeTruthy();
  });

  it('setData resolves after the ack; subscribe reports the current value and changes', async () => {
    connect(host, {'/a': 1});
    const seen: unknown[] = [];
    const stop = subscribe<number>('/a', value => seen.push(value));

    await setData('/a', 2);
    host.notify('data/changed', {path: '/a', value: 3});
    stop();
    host.notify('data/changed', {path: '/a', value: 4});

    expect(seen).toEqual([1, 2, 3]);
  });

  it('callFunction resolves with the value, and rejects and reports ui/error on failure', async () => {
    connect(host);
    host.handlers.set('function/call', params =>
      params['name'] === 'formatCurrency'
        ? {result: {value: `$${(params['args'] as {value: number}).value}`}}
        : {error: {code: -32012, message: 'Function nope is not allowed'}},
    );

    await expect(callFunction('formatCurrency', {value: 12})).resolves.toBe('$12');
    await expect(callFunction('nope')).rejects.toThrow('Function nope is not allowed');
    expect(host.received.filter(m => m.method === 'ui/error').map(m => m.params)).toEqual([
      {
        phase: 'bridge',
        message: 'Function nope failed: Function nope is not allowed',
        stack: expect.any(String),
      },
    ]);
  });

  it('useFunction keeps only the latest answer when an older one arrives late', async () => {
    connect(host);
    host.holdReplies = true;
    host.handlers.set('function/call', params => ({
      result: {value: `minutes for ${JSON.stringify(params['args'])}`},
    }));
    let setStops: (stops: string[]) => void = () => {};
    function Planner() {
      const [stops, set] = useData<string[]>('/trip/stops', ['a', 'b']);
      setStops = set;
      const {data, loading} = useFunction<string>('estimateTravelTime', {stops});
      return <p>{loading ? 'loading' : data}</p>;
    }
    host.handlers.set('data/set', params => ({
      result: {seq: params['seq'] as number, value: params['value'] as never},
    }));

    render(<Planner />);
    act(() => setStops(['b', 'a']));
    expect(screen.getByText('loading')).toBeTruthy();
    // Replies in arrival order: the subscribe, the first estimate, the write, the second estimate.
    const calls = host.requests('function/call');
    expect(calls.map(c => c.params?.['args'])).toEqual([{stops: ['a', 'b']}, {stops: ['b', 'a']}]);

    // Answer the newest estimate first, then the stale one.
    await act(async () => {
      host.releaseReplies([3, 2, 1, 0]);
      await flush();
    });

    expect(screen.getByText('minutes for {"stops":["b","a"]}')).toBeTruthy();
  });

  it('useFunction skips the call when args are null', async () => {
    connect(host);
    function App() {
      const {loading, data} = useFunction('querySales', null);
      return <p>{loading ? 'loading' : `idle ${String(data)}`}</p>;
    }

    render(<App />);
    await act(flush);

    expect(screen.getByText('idle undefined')).toBeTruthy();
    expect(host.requests('function/call')).toEqual([]);
  });

  it('dispatchAction sends action/dispatch with the context', async () => {
    connect(host);
    host.handlers.set('action/dispatch', () => ({result: {}}));

    await dispatchAction('confirmItinerary', {stops: ['a']});

    expect(host.requests('action/dispatch').map(r => r.params)).toEqual([
      {name: 'confirmItinerary', context: {stops: ['a']}},
    ]);
  });
});
