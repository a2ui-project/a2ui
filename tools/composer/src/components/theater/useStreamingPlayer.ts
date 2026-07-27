/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {useState, useEffect, useCallback, useRef, useMemo} from 'react';

export type PlaybackState = 'playing' | 'paused' | 'stopped';

export interface StreamChunk {
  /** Index in the scenario message array */
  index: number;
  /** The raw JSONL line (compact JSON, as it goes over the wire) */
  wire: string;
  /** The parsed message object */
  message: any;
  /** Whether this is a client event (↑) or server event (↓) */
  isClient: boolean;
  /** Byte size of the wire representation */
  bytes: number;
}

export interface LifecycleEvent {
  /** Which chunk triggered this */
  chunkIndex: number;
  /** Human-readable description */
  summary: string;
  /** Event category */
  type: 'surface' | 'components' | 'data' | 'action' | 'delete';
}

/** Convert scenario messages into stream chunks (real JSONL lines) */
function toStreamChunks(messages: any[]): StreamChunk[] {
  return messages.map((msg, i) => {
    const wire = JSON.stringify(msg);
    return {
      index: i,
      wire,
      message: msg,
      isClient: !!msg.action || !!msg.clientEvent,
      bytes: new TextEncoder().encode(wire).length,
    };
  });
}

/** Generate lifecycle events from messages */
function toLifecycleEvents(messages: any[]): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.beginRendering) {
      events.push({
        chunkIndex: i,
        summary: `Surface "${msg.beginRendering.surfaceId || 'default'}" created`,
        type: 'surface',
      });
    }
    if (msg.createSurface) {
      events.push({
        chunkIndex: i,
        summary: `Surface "${msg.createSurface.surfaceId}" created`,
        type: 'surface',
      });
    }
    if (msg.surfaceUpdate) {
      const count = msg.surfaceUpdate.components?.length || 0;
      const types = msg.surfaceUpdate.components
        ?.map((c: any) => (c.component ? Object.keys(c.component)[0] : c.type || '?'))
        .filter((v: string, j: number, a: string[]) => a.indexOf(v) === j);
      events.push({
        chunkIndex: i,
        summary: `${count} components registered: ${types?.join(', ')}`,
        type: 'components',
      });
    }
    if (msg.updateComponents) {
      const count = msg.updateComponents.components?.length || 0;
      events.push({chunkIndex: i, summary: `${count} components updated`, type: 'components'});
    }
    if (msg.dataModelUpdate) {
      const keys = msg.dataModelUpdate.contents?.map((c: any) => c.key).filter(Boolean) || [];
      events.push({chunkIndex: i, summary: `Data model: ${keys.join(', ')}`, type: 'data'});
    }
    if (msg.updateDataModel) {
      const keys = msg.updateDataModel.contents?.map((c: any) => c.key).filter(Boolean) || [];
      events.push({chunkIndex: i, summary: `Data model: ${keys.join(', ')}`, type: 'data'});
    }
    if (msg.clientEvent || msg.action) {
      const name = msg.clientEvent?.name || msg.action?.name || 'action';
      events.push({chunkIndex: i, summary: `User action: ${name}`, type: 'action'});
    }
    if (msg.deleteSurface) {
      events.push({
        chunkIndex: i,
        summary: `Surface "${msg.deleteSurface.surfaceId}" deleted`,
        type: 'delete',
      });
    }
  }
  return events;
}

export function useStreamingPlayer(messages: any[], baseIntervalMs = 800) {
  const chunks = useMemo(() => toStreamChunks(messages), [messages]);
  const lifecycleEvents = useMemo(() => toLifecycleEvents(messages), [messages]);

  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [progress, setProgress] = useState(0); // 0 to chunks.length
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalChunks = chunks.length;

  useEffect(() => {
    setProgress(0);
    setPlaybackState('stopped');
  }, [messages]);

  const play = useCallback(() => {
    if (progress >= totalChunks) setProgress(0);
    setPlaybackState('playing');
  }, [progress, totalChunks]);

  const pause = useCallback(() => setPlaybackState('paused'), []);

  const stop = useCallback(() => {
    setPlaybackState('stopped');
    setProgress(0);
  }, []);

  const seek = useCallback(
    (index: number) => {
      setProgress(Math.max(0, Math.min(index, totalChunks)));
    },
    [totalChunks],
  );

  // Playback timer — one chunk per tick
  useEffect(() => {
    if (playbackState === 'playing') {
      const ms = baseIntervalMs / speed;
      timerRef.current = setInterval(() => {
        setProgress(prev => {
          if (prev >= totalChunks) {
            setPlaybackState('paused');
            return prev;
          }
          return prev + 1;
        });
      }, ms);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playbackState, speed, totalChunks, baseIntervalMs]);

  // Chunks received so far
  const receivedChunks = chunks.slice(0, progress);

  // Messages for the renderer (fully received)
  const activeMessages = messages.slice(0, progress);

  // Visible lifecycle events
  const visibleEvents = lifecycleEvents.filter(e => e.chunkIndex < progress);

  // Total bytes received
  const bytesReceived = receivedChunks.reduce((sum, c) => sum + c.bytes, 0);
  const totalBytes = chunks.reduce((sum, c) => sum + c.bytes, 0);

  return {
    playbackState,
    progress,
    totalChunks,
    speed,
    chunks,
    receivedChunks,
    activeMessages,
    visibleEvents,
    lifecycleEvents,
    bytesReceived,
    totalBytes,
    play,
    pause,
    stop,
    seek,
    setSpeed,
  };
}
