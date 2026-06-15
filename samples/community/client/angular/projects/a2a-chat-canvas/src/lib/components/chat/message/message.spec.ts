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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {ChatService} from '@a2a_chat_canvas/services/chat-service';

import {Message} from './message';

describe('Message', () => {
  let component: Message;
  let fixture: ComponentFixture<Message>;
  let mockChatService: any;

  beforeEach(async () => {
    mockChatService = {
      a2uiSurfaces: signal(new Map()),
    };

    await TestBed.configureTestingModule({
      imports: [Message],
      providers: [{provide: ChatService, useValue: mockChatService}],
    }).compileComponents();

    fixture = TestBed.createComponent(Message);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('message', {
      type: 'ui_message',
      id: 'test-msg-id',
      contextId: 'test-context-id',
      role: {type: 'ui_user'},
      contents: [],
      status: 'completed',
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
