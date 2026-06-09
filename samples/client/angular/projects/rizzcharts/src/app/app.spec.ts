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

import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {ChatService} from '@a2a_chat_canvas/services/chat-service';
import {A2aService} from '@rizzcharts/services/a2a_service';

import {App} from './app';

describe('App', () => {
  let mockChatService: any;
  let mockA2aService: any;

  beforeEach(async () => {
    mockChatService = {
      sendMessage: jasmine.createSpy('sendMessage'),
      history: signal([]),
      isA2aStreamOpen: signal(false),
    };

    mockA2aService = {
      getAgentCard: jasmine
        .createSpy('getAgentCard')
        .and.returnValue(Promise.resolve({name: 'Mock Agent'})),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        {provide: ChatService, useValue: mockChatService},
        {provide: A2aService, useValue: mockA2aService},
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render agent name', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.agent-name')?.textContent).toContain('Mock Agent');
  });
});
