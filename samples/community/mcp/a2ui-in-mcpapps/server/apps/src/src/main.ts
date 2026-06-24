/*
 * Copyright 2026 Google LLC
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

import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  AfterViewInit,
  ElementRef,
} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {provideZonelessChangeDetection} from '@angular/core';
import {
  provideA2UI,
  MessageProcessor,
  Surface,
  DEFAULT_CATALOG,
  provideMarkdownRenderer,
} from '@a2ui/angular';
import {renderMarkdown} from '@a2ui/markdown-it';
import {theme} from './theme';

const A2UI_MIME_TYPE = 'application/a2ui+json';

@Component({
  selector: 'basic-mcp-app',
  standalone: true,
  imports: [Surface],
  templateUrl: './main.html',
  styleUrl: './main.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpAppRoot implements OnInit, AfterViewInit {
  private processor = inject(MessageProcessor);
  private elementRef = inject(ElementRef);

  protected status = signal('Idle');
  protected rawJson = signal<string>('');
  protected isLoading = signal(false);

  protected surfaces = computed(() => {
    return Array.from(this.processor.getSurfaces().entries());
  });

  ngOnInit() {
    this.initializeHandshake();
    this.setupActionRouting();
  }

  ngAfterViewInit() {
    this.setupResizeObserver();
  }

  private setupResizeObserver() {
    const observer = new ResizeObserver(() => {
      const height = this.elementRef.nativeElement.scrollHeight;
      console.log('[MCP App] Height updated:', height);
      this.postToParent({
        jsonrpc: '2.0',
        method: 'ui/resize',
        params: {height},
      });
    });
    observer.observe(this.elementRef.nativeElement);
  }

  private initializeHandshake() {
    this.postToParent({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'ui/initialize',
      params: {},
    });

    window.addEventListener('message', event => {
      if (event.data.id === 'init-1') {
        this.status.set('Initialized');
      }
    });
  }

  private setupActionRouting() {
    this.processor.events.subscribe(event => {
      if (!event.message.userAction) return;
      const requestId = 'action-' + Date.now();
      this.postToParent({
        jsonrpc: '2.0',
        id: requestId,
        method: `ui/${event.message.userAction.name}`,
        params: event.message.userAction.context,
      });

      const handler = (msgEvent: MessageEvent) => {
        if (msgEvent.data.id !== requestId) return;

        window.removeEventListener('message', handler);

        const content = msgEvent.data.result;
        if (!content || !Array.isArray(content)) return;

        try {
          const messages = this.getA2UIMessages(content);
          if (!messages) return;
          this.processor.processMessages(messages);
        } catch (e: unknown) {
          console.error('Failed to parse action response:', e);
        }
      };
      window.addEventListener('message', handler);
    });
  }

  fetchCounterA2UI() {
    this.status.set('Calling fetch_counter_a2ui...');
    this.isLoading.set(true);

    const requestId = 'ping-' + Date.now();
    this.postToParent({
      jsonrpc: '2.0',
      id: requestId,
      method: 'ui/fetch_counter_a2ui',
      params: {},
    });

    const handler = (event: MessageEvent) => {
      if (event.data.id !== requestId) return;

      this.isLoading.set(false);
      window.removeEventListener('message', handler);

      if (event.data.error) {
        this.status.set('Error: ' + event.data.error.message);
        return;
      }

      const content = event.data.result;
      if (!Array.isArray(content)) return;

      try {
        const messages = this.getA2UIMessages(content);
        if (!messages) {
          this.status.set('No A2UI payload found');
          return;
        }
        this.processor.clearSurfaces();
        this.processor.processMessages(messages);
        this.status.set('Rendered');
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.status.set('Parse Error: ' + errorMessage);
      }
    };
    window.addEventListener('message', handler);
  }

  private getA2UIMessages(content: any[]): any[] | null {
    const a2uiResource = content.find(
      (c: any) =>
        c.type === 'resource' &&
        (c.resource?.mimeType === A2UI_MIME_TYPE ||
          c.resource?.mimeType === 'application/json+a2ui'),
    );
    if (!a2uiResource || !a2uiResource.resource?.text) {
      return null;
    }
    const text = a2uiResource.resource.text;
    this.rawJson.set(text);
    const messages = JSON.parse(text);
    this.rawJson.set(JSON.stringify(messages, null, 2));
    return messages;
  }

  private postToParent(msg: any) {
    window.parent.postMessage(msg, 'http://localhost:4200');
  }
}

bootstrapApplication(McpAppRoot, {
  providers: [
    provideZonelessChangeDetection(),
    provideA2UI({
      catalog: DEFAULT_CATALOG,
      theme: theme,
    }),
    provideMarkdownRenderer(renderMarkdown),
  ],
}).catch(err => console.error(err));
