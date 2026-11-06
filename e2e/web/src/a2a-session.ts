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

/**
 * One renderer's conversation with a test agent over A2A.
 *
 * The session is the whole of the shell's transport logic, and it is the same for the Lit and
 * React shells: it sends the user's text as an A2A message carrying the renderer's capabilities,
 * feeds the `application/a2ui+json` DataParts the agent streams back into one web core
 * `MessageProcessor`, hands the text parts to the transcript, and sends the processor's outbound
 * envelopes (actions, errors, agent function calls) as DataParts of the next message. There are
 * no retries and no application logic, so what a test observes is the SDKs and the transport.
 */

import type {DataPart, Message, Part} from '@a2a-js/sdk';
import {type Client, ClientFactory} from '@a2a-js/sdk/client';
import {
  type ActionPayload,
  type A2uiErrorPayload,
  type Catalog,
  type ComponentApi,
  MessageProcessor,
  type ProtocolVersion,
  type SurfaceModel,
} from '@a2ui/web_core';

export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** The MIME type v0.9 transports used before the type was standardized. */
export const LEGACY_A2UI_MIME_TYPE = 'application/json+a2ui';

/** What the renderer advertises: a protocol version, or nothing for the turn. */
export type Capabilities = 'v1_0' | 'v0_9' | 'off';

/** An outbound envelope, as the renderer-to-agent schema of the version writes it. */
export type OutboundEnvelope = Record<string, unknown>;

export interface SessionOptions<T extends ComponentApi> {
  /** The agent's A2A endpoint, such as `http://localhost:10101/`. */
  readonly agentUrl: string;
  /** The wire version the renderer speaks, which decides the catalog and the metadata keys. */
  readonly version: ProtocolVersion;
  /** The catalogs the processor renders with, in priority order. */
  readonly catalogs: Catalog<T>[];
  /** What the renderer advertises on its next message. Can be changed between turns. */
  capabilities: Capabilities;
  /** Receives every text the agent streams, appended to the transcript. */
  readonly onText: (text: string, turn: number) => void;
  /** Receives the list of surfaces whenever it changes. */
  readonly onSurfaces: (surfaces: SurfaceModel<T>[]) => void;
  /** Receives the number of messages in flight and the number of turns completed. */
  readonly onProgress: (progress: Progress) => void;
}

export interface Progress {
  /** Messages sent whose reply has not finished streaming. */
  readonly inFlight: number;
  /** Replies that finished streaming, whether or not they succeeded. */
  readonly turns: number;
}

/** One thing that happened during a turn, in the order it happened. */
export interface TimelineEvent {
  readonly turn: number;
  /** A text part arrived, an A2UI part was processed, a surface was created, or the stream ended. */
  readonly kind: 'text' | 'a2ui' | 'surface' | 'end';
  /** `performance.now()` when it happened. */
  readonly at: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Reads the shell's query parameters, with the defaults a test relies on. */
export function readQuery(search: string = window.location.search): {
  agentUrl: string;
  capabilities: Capabilities;
  version: ProtocolVersion;
} {
  const params = new URLSearchParams(search);
  const agentUrl = params.get('agent') ?? 'http://localhost:10201/';
  const raw = params.get('caps') ?? 'v1_0';
  const capabilities: Capabilities = raw === 'v0_9' || raw === 'off' ? raw : 'v1_0';
  // A renderer that starts with its capabilities withdrawn is still a v1.0 renderer.
  const version: ProtocolVersion = capabilities === 'v0_9' ? 'v0.9' : '1.0';
  return {agentUrl, capabilities, version};
}

export class A2aSession<T extends ComponentApi> {
  readonly processor: MessageProcessor<T>;
  readonly contextId = uuid();
  /** What happened in each turn, for tests that check the order of streaming. */
  readonly timeline: TimelineEvent[] = [];
  /** Every A2UI envelope the agent sent, in the order received. */
  readonly received: Record<string, unknown>[] = [];
  /** Envelopes produced since the last message, sent with the next one. */
  private pending: OutboundEnvelope[] = [];
  /** The errors reported since the last message went out, so a repeat is sent once. */
  private reported = new Set<string>();
  private client?: Promise<Client>;
  private sending: Promise<void> = Promise.resolve();
  private turns = 0;
  private inFlight = 0;
  private completed = 0;

  constructor(private readonly options: SessionOptions<T>) {
    this.processor = new MessageProcessor<T>(options.catalogs, action => this.onAction(action), {
      version: options.version,
      reportErrorsOnly: true,
      outboundListener: message => {
        this.enqueue(message as unknown as OutboundEnvelope);
      },
    });
    this.processor.model.onError.subscribe(error => this.onError(error));
    const publish = () => options.onSurfaces([...this.processor.model.surfacesMap.values()]);
    this.processor.onSurfaceCreated(() => {
      this.record('surface');
      publish();
    });
    this.processor.onSurfaceDeleted(publish);
  }

  private record(kind: TimelineEvent['kind'], turn: number = this.turns - 1): void {
    this.timeline.push({turn, kind, at: performance.now()});
  }

  private progress(): void {
    this.options.onProgress({inFlight: this.inFlight, turns: this.completed});
  }

  get capabilities(): Capabilities {
    return this.options.capabilities;
  }

  set capabilities(value: Capabilities) {
    this.options.capabilities = value;
  }

  get version(): ProtocolVersion {
    return this.options.version;
  }

  /** Sends `text` as the user's next turn, with whatever envelopes are pending. */
  send(text: string): Promise<void> {
    return this.chain(() => this.exchange(text, this.takePending()));
  }

  /** The metadata the next message carries: the capabilities and the data model. */
  metadata(): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    const {version, capabilities} = this.options;
    if (capabilities !== 'off') {
      const key = version === '1.0' ? 'a2uiRendererCapabilities' : 'a2uiClientCapabilities';
      metadata[key] = this.processor.getRendererCapabilities({versions: [version]});
    }
    const dataModel = this.processor.getRendererDataModel(version);
    if (dataModel) {
      const key = version === '1.0' ? 'a2uiRendererDataModel' : 'a2uiClientDataModel';
      metadata[key] = dataModel;
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private onAction(action: ActionPayload): void {
    const {name, surfaceId, sourceComponentId, timestamp, context, userMessage, metadata} = action;
    const envelope: Record<string, unknown> = {name, surfaceId, sourceComponentId, timestamp};
    envelope.context = context ?? {};
    if (userMessage !== undefined) envelope.userMessage = userMessage;
    if (metadata !== undefined) envelope.metadata = metadata;
    this.enqueue({version: this.options.version, action: envelope});
  }

  private onError(error: A2uiErrorPayload): void {
    const {code, message, surfaceId, path, functionCallId} = error as A2uiErrorPayload & {
      path?: string;
      functionCallId?: string;
    };
    const body: Record<string, unknown> = {code, message};
    if (functionCallId !== undefined) {
      body.functionCallId = functionCallId;
    } else if (surfaceId !== undefined) {
      body.surfaceId = surfaceId;
    }
    if (path !== undefined) body.path = path;
    // A binding that fails is reported each time it is evaluated; one report per message is
    // enough for the agent, as in the Flutter example's session.
    const key = JSON.stringify(body);
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.enqueue({version: this.options.version, error: body});
  }

  /**
   * Queues an envelope for the next message and schedules that message.
   *
   * Envelopes raised while a reply streams in wait for the stream to end, so one message
   * carries every envelope one agent turn produced.
   */
  private enqueue(envelope: OutboundEnvelope): void {
    this.pending.push(envelope);
    this.chain(() =>
      this.pending.length > 0 ? this.exchange(undefined, this.takePending()) : Promise.resolve(),
    );
  }

  private takePending(): OutboundEnvelope[] {
    const envelopes = this.pending;
    this.pending = [];
    this.reported.clear();
    return envelopes;
  }

  /** Runs `step` after every message already scheduled, whether or not those succeeded. */
  private chain(step: () => Promise<void>): Promise<void> {
    this.sending = this.sending.then(step, step);
    return this.sending;
  }

  private async exchange(text: string | undefined, envelopes: OutboundEnvelope[]): Promise<void> {
    const turn = this.turns++;
    const parts: Part[] = [];
    if (text !== undefined) parts.push({kind: 'text', text});
    for (const envelope of envelopes) {
      const part: DataPart = {kind: 'data', data: envelope, metadata: {mimeType: A2UI_MIME_TYPE}};
      parts.push(part);
    }
    const metadata = this.metadata();
    const message: Message = {
      kind: 'message',
      messageId: uuid(),
      role: 'user',
      contextId: this.contextId,
      parts,
      ...(metadata ? {metadata} : {}),
    };
    this.inFlight++;
    this.progress();
    try {
      const client = await this.connect();
      const stream = client.sendMessageStream({message});
      for await (const event of stream) {
        if (event.kind === 'status-update' && event.status.message?.role === 'agent') {
          this.receive(event.status.message.parts, turn);
        } else if (event.kind === 'message' && event.role === 'agent') {
          this.receive(event.parts, turn);
        }
      }
    } finally {
      this.record('end', turn);
      this.inFlight--;
      this.completed++;
      this.progress();
    }
  }

  private receive(parts: Part[], turn: number): void {
    for (const part of parts) {
      if (part.kind === 'text') {
        if (part.text) {
          this.record('text', turn);
          this.options.onText(part.text, turn);
        }
        continue;
      }
      if (part.kind !== 'data') continue;
      const mime = (part.metadata as Record<string, unknown> | undefined)?.mimeType;
      if (mime !== A2UI_MIME_TYPE && mime !== LEGACY_A2UI_MIME_TYPE) continue;
      this.received.push(part.data);
      // Processing errors (an unknown surface, a bad component) surface through
      // `model.onError`, which queues them for the agent; nothing is thrown here.
      this.processor.processMessagesWithErrors([part.data]);
      this.record('a2ui', turn);
    }
  }

  /** Resolves the agent card once and builds the SDK client it names. */
  private connect(): Promise<Client> {
    this.client ??= new ClientFactory().createFromUrl(this.options.agentUrl);
    return this.client;
  }
}
