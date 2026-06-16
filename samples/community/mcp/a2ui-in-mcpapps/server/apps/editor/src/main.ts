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

// @ts-ignore
import EditorJS from '@editorjs/editorjs';
// @ts-ignore
import Paragraph from '@editorjs/paragraph';

const A2UI_MIME_TYPE = 'application/a2ui+json';

@Component({
  selector: 'editor-mcp-app',
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

  private editorInstance: any;
  private currentSelectionBlockId: string | null = null;
  private selectionTimeout: any;
  private currentRevision: {
    text_before: string;
    original_text: string;
    revised_text: string;
    text_after: string;
  } | null = null;

  protected surfaces = computed(() => {
    return Array.from(this.processor.getSurfaces().entries());
  });

  ngOnInit() {
    this.initializeHandshake();
    this.setupActionRouting();
  }

  ngAfterViewInit() {
    this.setupResizeObserver();
    this.initEditor();
  }

  private initEditor() {
    this.editorInstance = new EditorJS({
      holder: 'editorjs-container',
      placeholder: 'Let`s write an awesome doc!',
      tools: {
        paragraph: {
          class: Paragraph as any,
          inlineToolbar: false,
          sanitize: {
            mark: {
              class: true,
            },
          },
        },
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {text: 'Toad walks to the market. The sun shines bright.'},
          },
          {
            type: 'paragraph',
            data: {text: 'He buys a big red apple. It costs one coin.'},
          },
          {
            type: 'paragraph',
            data: {text: 'Toad eats his apple. He is happy.'},
          },
        ],
      },
      onChange: () => {
        this.debouncedSelectionCheck();
      },
    });

    // Attach mouse up listener ONLY to editor container to detect manual cursor highlight,
    // preventing interactions with the sidebar sliders from firing this listener.
    const holder = document.getElementById('editorjs-container');
    holder?.addEventListener('mouseup', () => this.debouncedSelectionCheck());
  }

  private debouncedSelectionCheck() {
    clearTimeout(this.selectionTimeout);
    this.selectionTimeout = setTimeout(() => this.checkTextSelection(), 500);
  }

  private async checkTextSelection() {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    // Only trigger if substantial text highlighted (e.g. > 10 chars)
    if (text.length < 10) {
      return;
    }

    // Confirm cursor actually inside Editor.js
    const holder = document.getElementById('editorjs-container');
    if (!holder || !selection?.anchorNode || !holder.contains(selection.anchorNode)) {
      return;
    }

    try {
      const activeIndex = this.editorInstance.blocks.getCurrentBlockIndex();
      // Guard against non-valid index
      if (activeIndex < 0) return;
      const block = this.editorInstance.blocks.getBlockByIndex(activeIndex);
      if (!block) return;
      this.currentSelectionBlockId = block.id;

      let fullText = text;
      try {
        const savedData = await this.editorInstance.save();
        const currentBlockData = savedData.blocks[activeIndex];
        if (currentBlockData && currentBlockData.data && currentBlockData.data.text) {
          fullText = currentBlockData.data.text;
        }
      } catch (e) {
        console.warn('[EditorApp] Failed to save editor data', e);
      }

      console.log('[EditorApp] Highlight detected:', text);
      this.fetchTuningControls(text, fullText);
    } catch (e) {
      console.warn('[EditorApp] Block detection failed', e);
    }
  }

  private fetchTuningControls(text: string, fullText: string) {
    this.status.set('AI Thinking...');
    this.isLoading.set(true);

    const requestId = 'get-controls-' + Date.now();
    this.postToParent({
      jsonrpc: '2.0',
      id: requestId,
      method: 'ui/smart_editor_get_controls',
      params: {text: text, full_text: fullText},
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
          this.status.set('Ready.');
          return;
        }
        this.processor.clearSurfaces();
        this.processor.processMessages(messages);
        this.status.set('UI Generated');
      } catch (e: any) {
        this.status.set('Parse Error');
      }
    };
    window.addEventListener('message', handler);
  }

  private setupResizeObserver() {
    const observer = new ResizeObserver(() => {
      const height = this.elementRef.nativeElement.scrollHeight;
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
  }

  private setupActionRouting() {
    this.processor.events.subscribe(event => {
      // In v0.8/v0.9, event structure holds the userAction data
      const action = event.message.userAction;
      if (!action) return;

      // Handle Accept/Reject actions
      if (action.name === 'smart_editor_accept') {
        this.handleAccept();
        return;
      }
      if (action.name === 'smart_editor_reject') {
        this.handleReject();
        return;
      }

      // Explicitly filter for the specific apply button action
      if (action.name !== 'smart_editor_apply') return;

      const surfaceId = action.surfaceId;
      const requestId = 'action-' + Date.now();

      // 1. Construct execution payload by merging userAction context WITH full local Data Model
      const params: any = {};

      // Look up surface data model values (sliders, text inputs, etc)
      const surfaceEntry = this.processor.getSurfaces().get(surfaceId);
      if (surfaceEntry && surfaceEntry.dataModel) {
        for (const [key, val] of surfaceEntry.dataModel.entries()) {
          params[key] = val;
        }
      }

      // Merge specific action payload contexts (labels, overrides)
      if (action.context && typeof action.context === 'object') {
        Object.assign(params, action.context);
      }

      this.status.set('Revising text...');
      this.isLoading.set(true);

      this.postToParent({
        jsonrpc: '2.0',
        id: requestId,
        method: `ui/${action.name}`,
        params: params,
      });

      const handler = (msgEvent: MessageEvent) => {
        if (msgEvent.data.id !== requestId) return;
        this.isLoading.set(false);
        window.removeEventListener('message', handler);

        const result = msgEvent.data.result;
        if (!result) return;

        if (!Array.isArray(result)) return;

        // CASE A: The result might be standard A2UI response (chain actions)
        const a2uiMsg = this.getA2UIMessages(result);
        if (a2uiMsg) {
          this.processor.processMessages(a2uiMsg);
          this.status.set('Done.');
          return;
        }

        // CASE B: Plain text result (returned from smart_editor_apply)
        const textRes = result.find((c: any) => c.type === 'text');
        if (textRes && textRes.text) {
          this.handleTextRevision(textRes.text);
        }
      };
      window.addEventListener('message', handler);
    });
  }

  private applyRewriteToEditor(newText: string) {
    if (this.currentSelectionBlockId === null) return;

    try {
      // Update active block in editor instance using block ID
      this.editorInstance.blocks.update(this.currentSelectionBlockId, {
        text: newText,
      });
    } catch (e) {
      console.error('[EditorApp] Failed to update block', e);
    }
  }

  private handleTextRevision(text: string) {
    try {
      const parsed = JSON.parse(text);
      this.currentRevision = parsed;
      const reconstructedText = `${parsed.text_before}<mark class="original">${parsed.original_text}</mark><mark class="revised">${parsed.revised_text}</mark>${parsed.text_after}`;
      this.applyRewriteToEditor(reconstructedText);
      this.status.set('Text Updated');
    } catch (e) {
      console.error('[EditorApp] Failed to parse revision JSON', e);
      // Fallback to just showing the text if it's not JSON
      this.applyRewriteToEditor(text);
      this.status.set('Text Updated (Raw)');
    }
    this.showAcceptRejectButtons();
  }

  private showAcceptRejectButtons() {
    const surface_id = 'editor-controls';
    const a2ui_messages = [
      {
        surfaceUpdate: {
          surfaceId: surface_id,
          components: [
            {id: 'root', component: {Card: {child: 'col'}}},
            {
              id: 'title',
              component: {
                Text: {text: {literalString: 'Revision Options'}, usageHint: 'h3' as const},
              },
            },
            {id: 'accept_btn_txt', component: {Text: {text: {literalString: 'Accept'}}}},
            {
              id: 'accept_btn',
              component: {
                Button: {
                  child: 'accept_btn_txt',
                  action: {name: 'smart_editor_accept'},
                  primary: true,
                },
              },
            },
            {id: 'reject_btn_txt', component: {Text: {text: {literalString: 'Reject'}}}},
            {
              id: 'reject_btn',
              component: {
                Button: {
                  child: 'reject_btn_txt',
                  action: {name: 'smart_editor_reject'},
                  primary: false,
                },
              },
            },
            {
              id: 'col',
              component: {
                Column: {children: {explicitList: ['title', 'accept_btn', 'reject_btn']}},
              },
            },
          ],
        },
      },
      {
        beginRendering: {
          surfaceId: surface_id,
          root: 'root',
        },
      },
    ];
    this.processor.processMessages(a2ui_messages as any);
  }

  private handleAccept() {
    console.log(
      '[EditorApp] handleAccept called. BlockId:',
      this.currentSelectionBlockId,
      'Revision:',
      this.currentRevision,
    );
    if (!this.currentSelectionBlockId || !this.currentRevision) {
      console.log(
        '[EditorApp] handleAccept returning early because blockId or revision is missing.',
      );
      return;
    }

    const {text_before, revised_text, text_after} = this.currentRevision;
    const acceptedText = `${text_before}${revised_text}${text_after}`;
    console.log('[EditorApp] Applying accepted text:', acceptedText);

    this.editorInstance.blocks.update(this.currentSelectionBlockId, {text: acceptedText});
    this.processor.clearSurfaces();
    this.status.set('Revision Accepted');
    this.currentRevision = null;
  }

  private handleReject() {
    console.log(
      '[EditorApp] handleReject called. BlockId:',
      this.currentSelectionBlockId,
      'Revision:',
      this.currentRevision,
    );
    if (!this.currentSelectionBlockId || !this.currentRevision) {
      console.log(
        '[EditorApp] handleReject returning early because blockId or revision is missing.',
      );
      return;
    }

    const {text_before, original_text, text_after} = this.currentRevision;
    const rejectedText = `${text_before}${original_text}${text_after}`;
    console.log('[EditorApp] Applying rejected text:', rejectedText);

    this.editorInstance.blocks.update(this.currentSelectionBlockId, {text: rejectedText});
    this.processor.clearSurfaces();
    this.status.set('Revision Rejected');
    this.currentRevision = null;
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
    const messages = JSON.parse(text);
    this.rawJson.set(JSON.stringify(messages, null, 2));
    return messages;
  }

  private postToParent(msg: any) {
    // Relay up to top host parent window
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
