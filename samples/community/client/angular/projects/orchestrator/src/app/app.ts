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

import {A2aChatCanvas} from '@a2a_chat_canvas/a2a-chat-canvas';
import {ChatService} from '@a2a_chat_canvas/services/chat-service';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  OnInit,
  Renderer2,
  inject,
  signal,
} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {RouterOutlet} from '@angular/router';
import {environment} from '../environments/environment';
import {demoMessageDecorator} from '../message-decorator/demo-message-decorator';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [A2aChatCanvas, RouterOutlet, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  protected demoMessageDecorator = demoMessageDecorator;
  protected readonly agentName = signal('Orchestrator Agent');
  private readonly chatService = inject(ChatService);
  private readonly renderer2 = inject(Renderer2);
  private readonly document = inject(DOCUMENT);

  ngOnInit() {
    const script = this.renderer2.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}&callback=initMap&libraries=marker`;
    script.async = true;
    script.defer = true;
    this.renderer2.appendChild(this.document.body, script);
  }

  sendMessage(text: string) {
    this.chatService.sendMessage(text);
  }
}
