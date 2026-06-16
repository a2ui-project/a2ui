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

import {TestBed} from '@angular/core/testing';
import {A2aServiceImpl} from './a2a-service-impl';

describe('A2aServiceImpl', () => {
  let service: A2aServiceImpl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [A2aServiceImpl],
    });
    service = TestBed.inject(A2aServiceImpl);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send contextId in request after receiving it from server', async () => {
    // Mock first response to return a contextId
    const mockResponse1 = {
      contextId: 'test-session-123',
      parts: [],
    };

    const fetchSpy = spyOn(globalThis, 'fetch').and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse1),
      } as Response),
    );

    // First call should NOT send contextId (it doesn't have it yet)
    await service.sendMessage([]);

    let lastCall = fetchSpy.calls.mostRecent();
    let body = JSON.parse(lastCall.args[1]!.body as string);
    expect(body.contextId).toBeUndefined();

    // Mock second response (just to complete the call)
    const mockResponse2 = {
      parts: [],
    };
    fetchSpy.and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse2),
      } as Response),
    );

    // Second call SHOULD send contextId
    await service.sendMessage([]);

    lastCall = fetchSpy.calls.mostRecent();
    body = JSON.parse(lastCall.args[1]!.body as string);
    expect(body.contextId).toBe('test-session-123');
  });

  it('should update contextId from data.result.contextId if contextId is missing', async () => {
    const mockResponse = {
      result: {
        contextId: 'test-session-456',
      },
      parts: [],
    };

    const fetchSpy = spyOn(globalThis, 'fetch').and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response),
    );

    await service.sendMessage([]);

    // Call again to see if it sends it
    fetchSpy.and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response),
    );

    await service.sendMessage([]);

    const lastCall = fetchSpy.calls.mostRecent();
    const body = JSON.parse(lastCall.args[1]!.body as string);
    expect(body.contextId).toBe('test-session-456');
  });
});
