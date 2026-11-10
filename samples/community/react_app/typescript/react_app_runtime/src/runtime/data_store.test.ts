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

import {describe, expect, it} from 'vitest';
import {AppDataStore, jsonEqual, type DataTransport} from './data_store.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

/** A transport whose replies the test settles by hand. */
class ManualTransport implements DataTransport {
  readonly sets: Array<{
    path: string;
    value: unknown;
    seq: number;
    reply: Deferred<{seq: number; value?: unknown}>;
  }> = [];
  readonly gets: Array<{path: string; reply: Deferred<{value?: unknown}>}> = [];
  readonly subscribes: Array<{path: string; reply: Deferred<{value?: unknown}>}> = [];

  get(path: string) {
    const reply = deferred<{value?: unknown}>();
    this.gets.push({path, reply});
    return reply.promise;
  }

  set(path: string, value: unknown, seq: number) {
    const reply = deferred<{seq: number; value?: unknown}>();
    this.sets.push({path, value, seq, reply});
    return reply.promise;
  }

  subscribe(path: string) {
    const reply = deferred<{value?: unknown}>();
    this.subscribes.push({path, reply});
    return reply.promise;
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('jsonEqual', () => {
  it('compares with JSON semantics', () => {
    expect(jsonEqual({a: 1, b: [1, {c: 2}]}, {b: [1, {c: 2}], a: 1})).toBe(true);
    expect(jsonEqual({a: 1, b: undefined}, {a: 1})).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({a: []}, {a: {}})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });
});

describe('AppDataStore', () => {
  it('seeds values and counts seeded paths as subscribed', () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);

    store.seed({'/loan/rate': 5}, ['/loan/rate', '/loan/empty']);
    store.watch('/loan/rate', () => {});
    store.watch('/loan/empty', () => {});

    expect(store.get('/loan/rate')).toBe(5);
    expect(store.has('/loan/empty')).toBe(false);
    expect(transport.subscribes).toEqual([]);
  });

  it('subscribes on the host once per path, on first watch', async () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    let notified = 0;

    store.watch('/a', () => notified++);
    store.watch('/a', () => notified++);
    transport.subscribes[0].reply.resolve({value: 'x'});
    await tick();

    expect(transport.subscribes.map(s => s.path)).toEqual(['/a']);
    expect(store.get('/a')).toBe('x');
    expect(notified).toBe(2);
  });

  it('writes optimistically and takes the acknowledged value', async () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    store.seed({'/a': 1}, ['/a']);

    const write = store.write('/a', 2);
    expect(store.get('/a')).toBe(2);
    expect(transport.sets[0]).toMatchObject({path: '/a', value: 2, seq: 1});

    transport.sets[0].reply.resolve({seq: 1, value: 2});
    await write;
    expect(store.get('/a')).toBe(2);
  });

  it('ignores host changes while writes are in flight, then applies the last ack', async () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    store.seed({'/a': 1}, ['/a']);
    const seen: unknown[] = [];
    store.watch('/a', () => seen.push(store.get('/a')));

    const first = store.write('/a', 2);
    const second = store.write('/a', 3);
    store.applyRemote('/a', true, 99);
    expect(store.get('/a')).toBe(3);

    transport.sets[0].reply.resolve({seq: 1, value: 2});
    await first;
    expect(store.get('/a')).toBe(3);
    transport.sets[1].reply.resolve({seq: 2, value: 3});
    await second;

    expect(store.get('/a')).toBe(3);
    expect(seen).toEqual([2, 3]);
    expect(transport.sets.map(s => s.seq)).toEqual([1, 2]);
  });

  it('applies host changes when no write is in flight, and skips equal values', () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    store.seed({'/a': {x: 1}}, ['/a']);
    let notified = 0;
    store.watch('/a', () => notified++);

    store.applyRemote('/a', true, {x: 1});
    store.applyRemote('/a', true, {x: 2});
    store.applyRemote('/a', false, undefined);

    expect(notified).toBe(2);
    expect(store.has('/a')).toBe(false);
  });

  it('re-reads the path from the host when the last write fails', async () => {
    const transport = new ManualTransport();
    const errors: unknown[] = [];
    const store = new AppDataStore(transport, (_path, error) => errors.push(error));
    store.seed({'/a': 1}, ['/a']);

    const write = store.write('/a', 2).catch((e: unknown) => e);
    transport.sets[0].reply.reject(new Error('refused'));
    await write;
    expect(transport.gets.map(g => g.path)).toEqual(['/a']);
    transport.gets[0].reply.resolve({value: 1});
    await tick();

    expect(store.get('/a')).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('drops a subscribe or read answer that a newer write overtook', async () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    store.watch('/a', () => {});
    const read = store.read('/a');

    const write = store.write('/a', 'mine');
    transport.sets[0].reply.resolve({seq: 1, value: 'mine'});
    await write;
    transport.subscribes[0].reply.resolve({});
    transport.gets[0].reply.resolve({value: 'old'});
    await read;
    await tick();

    expect(store.get('/a')).toBe('mine');
  });

  it('returns the same reference until the value changes', () => {
    const transport = new ManualTransport();
    const store = new AppDataStore(transport);
    store.seed({'/list': [1, 2]}, ['/list']);
    const before = store.get('/list');

    store.applyRemote('/list', true, [1, 2]);

    expect(store.get('/list')).toBe(before);
  });
});
