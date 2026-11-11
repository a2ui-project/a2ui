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

import {A2uiLitElement, type ComponentApi} from '@a2ui/web_core/v1_0';
import {css, html, nothing, type PropertyValues, type TemplateResult} from 'lit';
import {FrameSizing} from './frame_sizing.js';
import {
  listenForSandboxError,
  listenForSandboxProxyReady,
  sendSandboxResourceReady,
  type SandboxError,
  type SandboxProtocol,
  type SandboxResource,
} from './sandbox_bootstrap.js';
import {resolveSandboxUrl, type SandboxMode} from './sandbox_config.js';

/** Interprets a component's `height` property: only finite, positive numbers are applied. */
export function frameHeightFromProp(height: unknown): number | undefined {
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accessible name of a frame: the component's `accessibility.label` when set, else the fallback. */
export function frameTitleFromProps(accessibility: unknown, fallback: string): string {
  const label = isRecord(accessibility) ? accessibility['label'] : undefined;
  return typeof label === 'string' && label.trim() !== '' ? label : fallback;
}

/**
 * DOM event a {@link SandboxedFrameElement} dispatches when the proxy reports an error; `detail` is
 * the {@link SandboxError}. It bubbles and crosses shadow roots.
 */
export const SANDBOX_ERROR_EVENT = 'a2ui-sandbox-error';

/** Whether two resources would load the same content under the same restrictions. */
function sameResource(a: SandboxResource | null, b: SandboxResource | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.html === b.html &&
    a.url === b.url &&
    a.sandbox === b.sandbox &&
    JSON.stringify(a.permissions ?? null) === JSON.stringify(b.permissions ?? null) &&
    JSON.stringify(a.csp ?? null) === JSON.stringify(b.csp ?? null)
  );
}

/** What the element keeps between the first render of its frame and its removal. */
interface FrameSession {
  readonly frame: HTMLIFrameElement;
  readonly sandboxOrigin: string;
  readonly stopProxyReadyListener: () => void;
  readonly stopErrorListener: () => void;
  disconnectBridge: () => void;
  /** The resource the current bridge was connected for; a different one reconnects the bridge. */
  resource: SandboxResource | null;
}

/**
 * Base class of the universal components that run content in the sandbox proxy.
 *
 * The element renders one `<iframe>` in its light DOM that loads the proxy page for
 * {@link sandboxMode}. The proxy is embedded without a `sandbox` attribute on purpose: it needs
 * its real origin to check who embeds it and to exchange messages with the host by origin. The
 * untrusted content only ever runs in the inner frame the proxy creates, which never gets
 * `allow-same-origin`.
 *
 * Once the frame exists and the element has a `context`, the element listens for the proxy's
 * ready signal, answers it with {@link resolveResource}, and hands the frame to the protocol
 * bridge through {@link connectFrame}. The bridge is reconnected, and the resource sent again,
 * when the context or the resource changes; everything is torn down when the element leaves the
 * document, and set up again when it is re-attached (the browser reloads the frame, so the proxy
 * announces itself again). The `height` property sets the element's height; an app that asks for
 * a size through its protocol resizes the frame and the element through {@link FrameSizing}.
 *
 * When the proxy reports an error, for example because the content navigated away from the
 * document it was given, the element disconnects the bridge, hides the frame behind an alert with
 * the error message and dispatches {@link SANDBOX_ERROR_EVENT}. A new resource clears the error.
 *
 * The element can be styled through these CSS custom properties:
 *
 * - `--a2ui-sandboxed-frame-height`: height used when the `height` property is absent. Defaults
 *   to `500px`.
 * - `--a2ui-sandboxed-frame-border`: border around the frame. Defaults to a `--a2ui-border-width`
 *   wide line in `--a2ui-color-border`.
 * - `--a2ui-sandboxed-frame-border-radius`: corner radius. Defaults to `--a2ui-border-radius`.
 * - `--a2ui-sandboxed-frame-background`: background behind transparent content. Defaults to
 *   white, so content written for a light page stays readable.
 */
export abstract class SandboxedFrameElement<
  Api extends ComponentApi = ComponentApi,
> extends A2uiLitElement<Api> {
  /** @nocollapse */
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: var(--a2ui-sandboxed-frame-height, 500px);
      border: var(
        --a2ui-sandboxed-frame-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      border-radius: var(--a2ui-sandboxed-frame-border-radius, var(--a2ui-border-radius, 8px));
      background: var(--a2ui-sandboxed-frame-background, #fff);
      overflow: hidden;
      position: relative;
    }

    iframe {
      flex: 1;
      width: 100%;
      min-height: 0;
      border: none;
      background-color: transparent;
    }

    iframe[hidden] {
      display: none;
    }

    .a2ui-sandbox-error {
      padding: 12px;
      color: var(--a2ui-color-error, #b3261e);
    }
  `;

  /** Proxy page to load: `html` for inline content, `url` for external URLs. */
  protected abstract readonly sandboxMode: SandboxMode;

  /** Framing of the proxy handshake: the flat A2UI envelope or MCP Apps JSON-RPC. */
  protected abstract readonly sandboxProtocol: SandboxProtocol;

  /** The content the current properties ask for, or null when they describe none. */
  protected abstract resolveResource(): SandboxResource | null;

  /** The height in CSS pixels the current properties ask for, or undefined for the default. */
  protected abstract resolveHeight(): number | undefined;

  /** The accessible name of the frame. */
  protected abstract resolveTitle(): string;

  /**
   * Connects the protocol bridge to the frame. Called once the frame is in the document and the
   * element has a context; returns the function that disconnects the bridge again.
   */
  protected abstract connectFrame(frame: HTMLIFrameElement, sandboxOrigin: string): () => void;

  private sandboxUrl: URL | null = null;
  private session: FrameSession | null = null;
  private proxyReady = false;
  private appliedHeight: number | undefined = undefined;
  private sizing: FrameSizing | null = null;
  private sandboxError: SandboxError | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.sandboxUrl ??= resolveSandboxUrl(this.sandboxMode);
    // An element that comes back after a removal already has its frame; the browser reloads it.
    // A pending update takes care of the session itself.
    const frame = this.frameElement;
    if (frame && this.context && !this.isUpdatePending) {
      this.startSession(frame);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.endSession();
    // Removing the frame destroys its browsing context; the proxy has to announce itself again.
    this.proxyReady = false;
  }

  override render(): TemplateResult {
    const error = this.sandboxError;
    return html`${error
        ? html`<div class="a2ui-sandbox-error" role="alert">${error.message}</div>`
        : nothing}<iframe
        src=${this.sandboxUrl?.href ?? 'about:blank'}
        title=${this.resolveTitle()}
        ?hidden=${error !== null}
      ></iframe>`;
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    const frame = this.frameElement;
    if (!frame || !this.context) {
      return;
    }
    this.applyHeight(frame);
    if (!this.session) {
      this.startSession(frame);
      return;
    }
    const resource = this.resolveResource();
    if (changed.has('context') || !sameResource(resource, this.session.resource)) {
      if (this.sandboxError) {
        this.sandboxError = null;
        this.requestUpdate();
      }
      this.session.disconnectBridge();
      this.session.disconnectBridge = this.connectFrame(frame, this.session.sandboxOrigin);
      this.sendResource(resource);
    }
  }

  /**
   * Applies a size the embedded app asks for, within the limits of {@link FrameSizing}. Bridges
   * that apply resize requests themselves do not need it.
   */
  protected requestFrameSize(width?: number, height?: number): void {
    const frame = this.session?.frame;
    if (!frame) {
      return;
    }
    this.sizing ??= new FrameSizing({frame, threshold: 1});
    this.sizing.requestSize(width, height);
  }

  private get frameElement(): HTMLIFrameElement | null {
    return this.renderRoot.querySelector(':scope > iframe');
  }

  private startSession(frame: HTMLIFrameElement): void {
    const sandboxUrl = this.sandboxUrl;
    if (!sandboxUrl) {
      return;
    }
    const sandboxOrigin = sandboxUrl.origin;
    this.session = {
      frame,
      sandboxOrigin,
      stopProxyReadyListener: listenForSandboxProxyReady({
        frame,
        sandboxOrigin,
        protocol: this.sandboxProtocol,
        onReady: () => {
          this.proxyReady = true;
          this.sendResource(this.resolveResource());
        },
      }),
      stopErrorListener: listenForSandboxError({
        frame,
        sandboxOrigin,
        protocol: this.sandboxProtocol,
        onError: error => {
          this.handleSandboxError(error);
        },
      }),
      disconnectBridge: this.connectFrame(frame, sandboxOrigin),
      resource: null,
    };
    this.sendResource(this.resolveResource());
  }

  private endSession(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    this.session = null;
    session.stopProxyReadyListener();
    session.stopErrorListener();
    session.disconnectBridge();
    this.sizing?.dispose();
    this.sizing = null;
  }

  /**
   * Records the resource the bridge is connected for and posts it if the proxy is listening.
   * Clearing a loaded resource reloads the proxy page, so the previous document is gone and the
   * proxy announces itself again with an empty inner frame.
   */
  private sendResource(resource: SandboxResource | null): void {
    const session = this.session;
    if (!session) {
      return;
    }
    const hadResource = session.resource !== null;
    session.resource = resource;
    if (!resource) {
      if (hadResource) {
        // Lit does not re-set an unchanged `src`; assigning it imperatively reloads the proxy.
        this.proxyReady = false;
        session.frame.src = this.sandboxUrl?.href ?? 'about:blank';
      }
      return;
    }
    if (!this.proxyReady) {
      return;
    }
    sendSandboxResourceReady({
      frame: session.frame,
      sandboxOrigin: session.sandboxOrigin,
      protocol: this.sandboxProtocol,
      resource,
    });
  }

  /**
   * Stops the session's traffic after the proxy reports an error: the proxy relays nothing more,
   * so the bridge would only wait for an app that is gone.
   */
  private handleSandboxError(error: SandboxError): void {
    const session = this.session;
    if (!session) {
      return;
    }
    session.disconnectBridge();
    session.disconnectBridge = () => {};
    console.error(`[SandboxedFrame] ${error.message}`);
    this.sandboxError = error;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent<SandboxError>(SANDBOX_ERROR_EVENT, {
        detail: error,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private applyHeight(frame: HTMLIFrameElement): void {
    const height = this.resolveHeight();
    if (height === this.appliedHeight) {
      return;
    }
    this.appliedHeight = height;
    this.style.height = height === undefined ? '' : `${height}px`;
    // A size the app requested earlier gives way to the new property value.
    frame.style.removeProperty('height');
  }
}
