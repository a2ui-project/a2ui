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
  DataModelSync,
  deepEqual,
  resolveBoundPath,
  type DataModelUpdate,
} from './data_model_sync.js';
import {FakeFrameHost} from './testing/fake_frame_host.js';

describe('resolveBoundPath', () => {
  it('returns the bound path without a subpath', () => {
    expect(resolveBoundPath('/game', undefined)).toBe('/game');
    expect(resolveBoundPath('/game', '')).toBe('/game');
  });

  it('appends the subpath with exactly one slash', () => {
    expect(resolveBoundPath('/game', '/score')).toBe('/game/score');
    expect(resolveBoundPath('/game', 'score')).toBe('/game/score');
  });
});

describe('deepEqual', () => {
  it('compares primitives, arrays and objects structurally', () => {
    expect(deepEqual(1, 1)).toBeTrue();
    expect(deepEqual('a', 'b')).toBeFalse();
    expect(deepEqual(null, undefined)).toBeFalse();
    expect(deepEqual([1, {a: 2}], [1, {a: 2}])).toBeTrue();
    expect(deepEqual([1, 2], [2, 1])).toBeFalse();
    expect(deepEqual({a: 1, b: {c: [1]}}, {b: {c: [1]}, a: 1})).toBeTrue();
    expect(deepEqual({a: 1}, {a: 1, b: 2})).toBeFalse();
    expect(deepEqual({a: 1}, [1])).toBeFalse();
  });

  it('treats undefined fields as absent', () => {
    expect(deepEqual({a: 1, b: undefined}, {a: 1})).toBeTrue();
  });
});

describe('DataModelSync', () => {
  let host: FakeFrameHost;
  let updates: DataModelUpdate[];
  let sync: DataModelSync;

  beforeEach(() => {
    host = new FakeFrameHost({
      game: {score: 1, player: 'ann'},
      title: 'Pong',
      tags: ['a', 'b'],
    });
    updates = [];
    sync = new DataModelSync({
      host,
      paths: {game: '/game', title: '/title', tags: '/tags', missing: '/nowhere'},
      sendUpdate: update => updates.push(update),
    });
  });

  afterEach(() => {
    sync.dispose();
  });

  describe('start', () => {
    it('returns the current value of every binding and subscribes to each path', () => {
      expect(sync.start()).toEqual({
        game: {score: 1, player: 'ann'},
        title: 'Pong',
        tags: ['a', 'b'],
        missing: undefined,
      });
      expect(host.subscriberCount).toBe(4);
      expect(updates).toEqual([]);
    });

    it('replaces earlier subscriptions when called again', () => {
      sync.start();
      sync.start();
      expect(host.subscriberCount).toBe(4);
      host.setData('/title', 'Tennis');
      expect(updates).toEqual([{key: 'title', value: 'Tennis'}]);
    });
  });

  describe('host to frame', () => {
    beforeEach(() => {
      sync.start();
    });

    it('sends a primitive change whole', () => {
      host.setData('/title', 'Tennis');
      expect(updates).toEqual([{key: 'title', value: 'Tennis'}]);
    });

    it('sends only the changed fields of an object as subpath updates', () => {
      host.setData('/game', {score: 2, player: 'ann'});
      expect(updates).toEqual([{key: 'game', subpath: '/score', value: 2}]);
    });

    it('sends a new field of an object', () => {
      host.setData('/game/round', 3);
      expect(updates).toEqual([{key: 'game', subpath: '/round', value: 3}]);
    });

    it('emits undefined for a field removed from an object', () => {
      host.setData('/game', {score: 1});
      expect(updates).toEqual([{key: 'game', subpath: '/player', value: undefined}]);
    });

    it('sends every field when the previous value was not an object', () => {
      host.setData('/title', {short: 'P', long: 'Pong'});
      expect(updates).toEqual([
        {key: 'title', subpath: '/short', value: 'P'},
        {key: 'title', subpath: '/long', value: 'Pong'},
      ]);
    });

    it('sends changed array items by index', () => {
      host.setData('/tags', ['a', 'c']);
      expect(updates).toEqual([{key: 'tags', subpath: '/1', value: 'c'}]);
    });

    it('drops changes that are structurally equal to what the frame has', () => {
      host.setData('/game', {player: 'ann', score: 1});
      host.setData('/title', 'Pong');
      expect(updates).toEqual([]);
    });

    it('escapes JSON pointer characters in field names', () => {
      host.setData('/game', {score: 1, player: 'ann', 'a/b~c': true});
      expect(updates).toEqual([{key: 'game', subpath: '/a~1b~0c', value: true}]);
    });

    it('sends a whole update when an object becomes null', () => {
      host.setData('/game', null);
      expect(updates).toEqual([{key: 'game', value: null}]);
    });
  });

  describe('frame to host', () => {
    beforeEach(() => {
      sync.start();
    });

    it('writes a whole binding without echoing it back', () => {
      expect(sync.applyChange({key: 'title', value: 'Tennis'})).toBe('applied');
      expect(host.getData('/title')).toBe('Tennis');
      expect(updates).toEqual([]);
    });

    it('writes a field through a subpath, with or without the leading slash', () => {
      expect(sync.applyChange({key: 'game', subpath: '/score', value: 5})).toBe('applied');
      expect(sync.applyChange({key: 'game', subpath: 'player', value: 'bob'})).toBe('applied');
      expect(host.getData('/game')).toEqual({score: 5, player: 'bob'});
      expect(updates).toEqual([]);
    });

    it('reports an equal value as unchanged and does not write it', () => {
      expect(sync.applyChange({key: 'game', value: {player: 'ann', score: 1}})).toBe('unchanged');
      expect(sync.applyChange({key: 'game', subpath: '/score', value: 1})).toBe('unchanged');
    });

    it('reports keys that are not bound', () => {
      expect(sync.applyChange({key: 'unknown', value: 1})).toBe('unbound');
    });

    it('diffs later host changes against the state the frame wrote', () => {
      sync.applyChange({key: 'game', subpath: '/score', value: 5});
      host.setData('/game/player', 'bob');
      expect(updates).toEqual([{key: 'game', subpath: '/player', value: 'bob'}]);
    });

    it('lifts the echo suppression when the write throws', () => {
      expect(() => sync.applyChange({key: 'game', subpath: '/__proto__', value: 1})).toThrowError(
        /Invalid path segment/,
      );
      host.setData('/title', 'Tennis');
      expect(updates).toEqual([{key: 'title', value: 'Tennis'}]);
    });
  });

  describe('dispose', () => {
    it('unsubscribes from every path and stops sending updates', () => {
      sync.start();
      sync.dispose();
      expect(host.subscriberCount).toBe(0);
      host.setData('/title', 'Tennis');
      expect(updates).toEqual([]);
    });
  });
});
