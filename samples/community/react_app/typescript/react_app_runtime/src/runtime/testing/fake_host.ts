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

import {BridgeClient, type BridgeEventSource, type BridgePeer} from '../bridge_client.js';

/** A JSON-RPC message as the fake host sees it. */
export interface HostMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

/** What a request handler returns: a result, or an error response. */
export type HostReply =
  | {readonly result: Record<string, unknown>}
  | {readonly error: {code: number; message: string}};

/**
 * A host for app-side tests: receives what the client posts, answers requests with the handler
 * of their method (asynchronously, like `postMessage`), and sends notifications to the client.
 * Replies can be held back to test ordering.
 */
export class FakeHost implements BridgePeer {
  readonly received: HostMessage[] = [];
  readonly events: BridgeEventSource & EventTarget = new EventTarget() as BridgeEventSource &
    EventTarget;
  readonly handlers = new Map<string, (params: Record<string, unknown>) => HostReply | null>();
  private readonly held: Array<() => void> = [];
  holdReplies = false;

  postMessage(message: unknown): void {
    const parsed = JSON.parse(JSON.stringify(message)) as HostMessage;
    this.received.push(parsed);
    if (parsed.id === undefined || parsed.method === undefined) {
      return;
    }
    const handler = this.handlers.get(parsed.method);
    const reply: HostReply | null = handler
      ? handler(parsed.params ?? {})
      : {error: {code: -32601, message: `No handler for ${parsed.method}`}};
    if (reply === null) {
      return;
    }
    const send = () => this.deliver({jsonrpc: '2.0', id: parsed.id, ...reply});
    if (this.holdReplies) {
      this.held.push(send);
    } else {
      setTimeout(send, 0);
    }
  }

  /** Sends the held replies, in the order given by `order` (indexes), or all in order. */
  releaseReplies(order?: number[]): void {
    const replies = this.held.splice(0);
    for (const index of order ?? replies.map((_, i) => i)) {
      replies[index]?.();
    }
  }

  /** Sends a notification to the client. */
  notify(method: string, params: Record<string, unknown>): void {
    this.deliver({jsonrpc: '2.0', method, params});
  }

  /** The requests received for `method`. */
  requests(method: string): HostMessage[] {
    return this.received.filter(message => message.method === method && message.id !== undefined);
  }

  /** A client connected to this host. */
  createClient(): BridgeClient {
    return new BridgeClient(this, this.events);
  }

  private deliver(data: unknown): void {
    // jsdom's MessageEvent only accepts a real window as `source`, so the fields are attached to a
    // plain event instead.
    const event = new Event('message');
    Object.defineProperty(event, 'data', {value: data});
    Object.defineProperty(event, 'source', {value: this});
    this.events.dispatchEvent(event);
  }
}

/** Waits until queued timers and microtasks have run. */
export function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
