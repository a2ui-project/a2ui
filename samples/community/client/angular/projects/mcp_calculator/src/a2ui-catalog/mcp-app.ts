/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import {CatalogComponent, A2uiRendererService} from '@a2ui/angular/v0_9';
import {
  AppBridge,
  PostMessageTransport,
  SANDBOX_PROXY_READY_METHOD,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';

@Component({
  selector: 'a2ui-mcp-app',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 500px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }

    iframe {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      background-color: white; /* Ensure content is readable */
    }
  `,
  template: `
    @if (resolvedContent()) {
      <iframe #iframe [src]="iframeSrc()" [title]="resolvedTitle() || 'MCP App'"></iframe>
    }
  `,
})
export class McpApp extends CatalogComponent<any> implements OnDestroy, OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly rendererService = inject(A2uiRendererService);

  protected readonly resolvedContent = computed<string | null>(() => {
    const boundProp = this.props()['content']?.value() ?? null;
    console.log('[McpApp] boundProp:', boundProp);
    let rawContent: any = boundProp;
    if (boundProp && typeof boundProp === 'object' && 'id' in boundProp) {
      rawContent = boundProp.id;
    }
    if (rawContent && typeof rawContent === 'string' && rawContent.startsWith('url_encoded:')) {
      rawContent = decodeURIComponent(rawContent.substring(12));
    }
    console.log(
      '[McpApp] resolvedContent:',
      rawContent ? rawContent.substring(0, 100) + '...' : null,
    );
    return typeof rawContent === 'string' ? rawContent : null;
  });

  private readonly contentUpdate = effect(() => {
    const rawContent = this.resolvedContent();
    const bridge = this.appBridge();
    console.log('[McpApp] contentUpdate effect - bridge:', !!bridge, 'hasContent:', !!rawContent);
    if (bridge && rawContent) {
      bridge
        .sendSandboxResourceReady({
          html: rawContent,
          sandbox: 'allow-scripts',
        })
        .catch(err => console.error('Failed to update sandbox content:', err));
    }
  });

  protected readonly allowedTools = computed<string[]>(
    () => this.props()['allowedTools']?.value() || [],
  );
  protected readonly resolvedTitle = computed<string | null>(
    () => this.props()['title']?.value() ?? null,
  );

  protected readonly iframeSrc = signal<SafeResourceUrl | null>(
    this.sanitizer.bypassSecurityTrustResourceUrl('about:blank'),
  );

  private iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('iframe');
  private appBridge = signal<AppBridge | null>(null);
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  ngOnInit() {
    this.setupSandbox();
  }

  ngOnDestroy() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }
    const bridge = this.appBridge();
    if (bridge) {
      bridge.close().catch(e => console.error('Error closing AppBridge on destroy:', e));
    }
  }

  private setupSandbox() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }

    this.messageHandler = (event: MessageEvent) => {
      // Check if the message is from our iframe
      if (
        this.iframe().nativeElement &&
        event.source === this.iframe().nativeElement.contentWindow &&
        event.data?.method === SANDBOX_PROXY_READY_METHOD
      ) {
        // Init bridge
        this.initializeBridge();
      }
    };

    window.addEventListener('message', this.messageHandler);

    // Check for query param to opt-out of origin toggle (for testing)
    const urlParams = new URLSearchParams(window.location.search);
    const disableSecuritySelfTest = urlParams.get('disable_security_self_test') === 'true';

    const currentOrigin = window.location.origin;
    let sandboxUrl = `${currentOrigin}/mcp_apps_inner_iframe/sandbox.html`;
    if (disableSecuritySelfTest) {
      sandboxUrl += '?disable_security_self_test=true';
    }
    this.iframeSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(sandboxUrl));
  }

  private async initializeBridge() {
    if (!this.iframe().nativeElement.contentWindow) {
      return;
    }

    const iframe = this.iframe().nativeElement;

    // The app bridge is initialized without a direct connection to MCP server.
    // Communication with MCP server is expected to be handled by the sandbox iframe.
    const emptyMcpClient = null;
    const bridge = new AppBridge(
      emptyMcpClient,
      {name: 'MCP Calculator', version: '1.0.0'},
      {
        openLinks: {},
        logging: {},
        serverTools: {}, // Advertise support if we had a client
      },
    );

    bridge.onloggingmessage = params => {
      console.log(`[MCP App Log] ${params.level}:`, params.data);
    };

    bridge.oninitialized = () => {
      console.log('MCP App Initialized');
    };

    bridge.onsizechange = ({width, height}) => {
      // TODO: Implement dynamic resizing
      // Reference implementation in mcp-apps-custom-component.ts:
      // - Listen for size changes from the embedded app
      // - Update the iframe's width/height styles (with animation if desired)
      // - This prevents scrollbars and ensures the app fits its content
      //
      // Example logic:
      // if (height !== undefined) {
      //   this.iframe().nativeElement.style.height = `${height}px`;
      // }
      console.log(`[MCP App] Resize requested: ${width}x${height}`);
    };

    bridge.oncalltool = async params => {
      console.log(`[MCP App] Tool call requested: ${params.name}`, params);

      if (!this.allowedTools().includes(params.name)) {
        console.warn(`[MCP App] Tool '${params.name}' not allowed.`);
        throw new Error(`Tool '${params.name}' not allowed`);
      }

      const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
      if (surface) {
        const action = {
          event: {
            name: params.name,
            context: params.arguments || {},
          },
        };
        console.log('Sending action:', action);
        surface.dispatchAction(action, this.componentId());
      }

      // Return empty result immediately (calculator UI can forget about it)
      return {content: []};
    };

    // Connect the bridge
    // We must pass the iframe's contentWindow as the target
    const transport = new PostMessageTransport(
      // The first argument is the target window to send messages TO (the iframe).
      // The second argument is the source window to validate messages FROM (also the iframe).
      iframe.contentWindow!,
      iframe.contentWindow!,
    );
    await bridge.connect(transport);

    // Clean up old bridge to prevent memory leaks and zombie event listeners.
    const oldBridge = this.appBridge();
    if (oldBridge) {
      oldBridge.close().catch(e => console.error('Error closing previous AppBridge:', e));
    }
    // Set the new bridge.
    this.appBridge.set(bridge);
  }
}
