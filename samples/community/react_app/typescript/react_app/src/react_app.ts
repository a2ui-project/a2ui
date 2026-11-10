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

import type {ComponentApi, WebComponentImplementation} from '@a2ui/web_core/v1_0';
import {css} from 'lit';
import {z} from 'zod';
import {buildAppDocument} from './app_document.js';
import {
  ReactAppBridge,
  createFrameTransport,
  type ReactAppBridgeEvent,
  type ReactAppTimings,
} from './react_app_bridge.js';
import {getReactAppConfig, loadRuntime, type LoadedRuntime} from './react_app_config.js';
import {ReactAppFrameHost} from './react_app_frame_host.js';
import type {SandboxProtocol, SandboxResource} from './shared/sandbox/sandbox_bootstrap.js';
import type {SandboxMode} from './shared/sandbox/sandbox_config.js';
import {
  frameHeightFromProp,
  SandboxedFrameElement,
} from './shared/sandbox/sandboxed_frame_element.js';
import {readThemeTokens} from './theme_tokens.js';

/** Sandbox flags of the app frame: scripts only, in an opaque origin. */
export const REACT_APP_INNER_SANDBOX = 'allow-scripts';

/** Height of the frame when the component sets none. */
export const DEFAULT_REACT_APP_HEIGHT = 360;

/** Accessible name of the frame when the component sets no `title`. */
export const DEFAULT_REACT_APP_TITLE = 'Interactive app';

/** DOM event the element dispatches for every bridge event; `detail` is a `ReactAppBridgeEvent`. */
export const REACT_APP_BRIDGE_EVENT = 'react-app-bridge';
/** DOM event the element dispatches for a `ui/error`; `detail` is the `ReactAppError`. */
export const REACT_APP_ERROR_EVENT = 'react-app-error';
/** DOM event the element dispatches for `ui/rendered`; `detail` has the timings and latency. */
export const REACT_APP_RENDERED_EVENT = 'react-app-rendered';

/** The `ReactApp` component of the ReactApp catalog (`catalog/v1/catalog.json`). */
export const ReactAppApi = {
  name: 'ReactApp',
  schema: z
    .object({
      'source': z
        .string()
        .describe('The complete TSX source of the app: one file that default-exports `App`.'),
      'title': z.string().optional().describe('A short title; the accessible name of the frame.'),
      'height': z.number().optional().describe('The height of the frame in CSS pixels.'),
      'dataPaths': z
        .array(z.string())
        .optional()
        .describe('Allowlist of the data model paths the app may read and write.'),
      'functions': z
        .array(z.string())
        .optional()
        .describe('Allowlist of the functions the app may call.'),
      'compiled': z
        .string()
        .optional()
        .describe(
          'The app compiled to JavaScript by the agent server; skips in-browser compiling.',
        ),
    })
    .strict(),
} satisfies ComponentApi;

/** Properties of `ReactApp`, as declared in the catalog. */
export type ReactAppProps = z.infer<typeof ReactAppApi.schema>;

function stringList(value: readonly unknown[] | undefined): string[] | undefined {
  // The binder types string arrays as possible child lists; the catalog declares plain strings.
  return value?.filter((item): item is string => typeof item === 'string');
}

/**
 * The element of `ReactApp`: a sandboxed frame running the app on the ReactApp runtime, with a
 * {@link ReactAppBridge} to the surface.
 *
 * Besides `--a2ui-react-app-border` and `--a2ui-react-app-background` (and the height property of
 * `SandboxedFrameElement`), it dispatches these events
 * (bubbling and composed): `react-app-bridge` for every bridge message and lifecycle event,
 * `react-app-error` for an app error, `react-app-rendered` once the app painted.
 */
class ReactAppElement extends SandboxedFrameElement<typeof ReactAppApi> {
  /**
   * Apps are themed like the page, so the frame is borderless and transparent unless the host
   * sets `--a2ui-react-app-border` or `--a2ui-react-app-background`.
   * @nocollapse
   */
  static override styles = css`
    ${SandboxedFrameElement.styles}
    :host {
      border: var(--a2ui-react-app-border, none);
      background: var(--a2ui-react-app-background, transparent);
    }
  `;

  protected override readonly api = ReactAppApi;
  protected readonly sandboxMode: SandboxMode = 'html';
  protected readonly sandboxProtocol: SandboxProtocol = 'a2ui';

  /** The `ui/rendered` timings of the current app, once it rendered. */
  lastRendered: {timings: ReactAppTimings; frameReadyToRenderedMs: number} | null = null;

  private runtime: LoadedRuntime | null = null;
  private bridge: ReactAppBridge | null = null;

  override connectedCallback() {
    super.connectedCallback();
    if (!this.runtime) {
      loadRuntime().then(
        runtime => {
          this.runtime = runtime;
          this.requestUpdate();
        },
        (error: unknown) => {
          console.error('[ReactApp] Could not load the runtime:', error);
          this.dispatchReactAppEvent(REACT_APP_ERROR_EVENT, {
            phase: 'load',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  }

  /** Sends the page's current theme to the app, for hosts that change it at runtime. */
  refreshTheme(): void {
    this.bridge?.sendTheme(readThemeTokens(this, getReactAppConfig().themeVariables));
  }

  protected resolveResource(): SandboxResource | null {
    const {source, compiled, title} = this.controller.props;
    if (!this.runtime || typeof source !== 'string' || source.trim() === '') {
      return null;
    }
    return {
      html: buildAppDocument(this.runtime, {
        source,
        ...(typeof compiled === 'string' ? {compiled} : {}),
        ...(typeof title === 'string' ? {title} : {}),
      }),
      sandbox: REACT_APP_INNER_SANDBOX,
      csp: {resourceDomains: [this.runtime.baseUrl.origin]},
    };
  }

  protected resolveHeight(): number {
    return frameHeightFromProp(this.controller.props.height) ?? DEFAULT_REACT_APP_HEIGHT;
  }

  protected resolveTitle(): string {
    const {title} = this.controller.props;
    return typeof title === 'string' && title.trim() !== '' ? title : DEFAULT_REACT_APP_TITLE;
  }

  protected connectFrame(frame: HTMLIFrameElement, sandboxOrigin: string): () => void {
    this.lastRendered = null;
    const bridge = new ReactAppBridge({
      transport: createFrameTransport(frame, sandboxOrigin),
      host: new ReactAppFrameHost(this.context),
      getProps: () => {
        const {dataPaths, functions} = this.controller.props;
        return {dataPaths: stringList(dataPaths), functions: stringList(functions)};
      },
      getTheme: () => readThemeTokens(this, getReactAppConfig().themeVariables),
      getContainerSize: () => ({width: frame.clientWidth, height: frame.clientHeight}),
      onResize: height => {
        // The app can ask for more room than `height`, never less.
        this.requestFrameSize(undefined, Math.max(height, this.resolveHeight()));
      },
      onEvent: event => this.handleBridgeEvent(event),
    });
    this.bridge = bridge;
    bridge.start();
    const colorScheme =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const onSchemeChange = () => this.refreshTheme();
    colorScheme?.addEventListener?.('change', onSchemeChange);
    return () => {
      colorScheme?.removeEventListener?.('change', onSchemeChange);
      bridge.dispose();
      if (this.bridge === bridge) {
        this.bridge = null;
      }
    };
  }

  private handleBridgeEvent(event: ReactAppBridgeEvent): void {
    this.dispatchReactAppEvent(REACT_APP_BRIDGE_EVENT, event);
    if (event.type === 'error') {
      this.dispatchReactAppEvent(REACT_APP_ERROR_EVENT, event.error);
    } else if (event.type === 'rendered') {
      this.lastRendered = {
        timings: event.timings,
        frameReadyToRenderedMs: event.frameReadyToRenderedMs,
      };
      this.dispatchReactAppEvent(REACT_APP_RENDERED_EVENT, this.lastRendered);
    }
  }

  private dispatchReactAppEvent(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}));
  }
}

/** Registration entry of `ReactApp` for a `Catalog`. */
export const A2uiReactApp: WebComponentImplementation<typeof ReactAppApi.schema> = {
  ...ReactAppApi,
  tagName: 'a2ui-react-app',
  element: ReactAppElement,
};
