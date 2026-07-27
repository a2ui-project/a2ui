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

import {useState, useEffect, useCallback, useRef} from 'react';

export type PlaybackState = 'playing' | 'paused' | 'stopped';

export interface UseJsonlPlayerOptions<T> {
  messages: T[];
  autoPlay?: boolean;
  baseIntervalMs?: number;
  initialProgress?: number;
}

export function useJsonlPlayer<T>({
  messages,
  autoPlay = false,
  baseIntervalMs = 500,
  initialProgress = 0,
}: UseJsonlPlayerOptions<T>) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>(
    autoPlay ? 'playing' : 'stopped',
  );
  // progress represents the *number of messages* currently active (0 to totalMessages)
  const [progress, setProgress] = useState(Math.min(initialProgress, messages.length));
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalMessages = messages.length;

  // Reset progress when messages change
  useEffect(() => {
    setProgress(Math.min(initialProgress, messages.length));
  }, [messages, initialProgress]);

  const play = useCallback(() => {
    if (progress >= totalMessages) {
      setProgress(0); // Loop or restart
    }
    setPlaybackState('playing');
  }, [progress, totalMessages]);

  const pause = useCallback(() => {
    setPlaybackState('paused');
  }, []);

  const stop = useCallback(() => {
    setPlaybackState('stopped');
    setProgress(0);
  }, []);

  const seek = useCallback(
    (index: number) => {
      if (index >= 0 && index <= totalMessages) {
        setProgress(index);
      }
    },
    [totalMessages],
  );

  useEffect(() => {
    if (playbackState === 'playing') {
      const ms = baseIntervalMs / speed;
      timerRef.current = setInterval(() => {
        setProgress(prev => {
          if (prev >= totalMessages) {
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
  }, [playbackState, speed, totalMessages, baseIntervalMs]);

  const activeMessages = messages.slice(0, progress);

  return {
    playbackState,
    progress,
    speed,
    totalMessages,
    activeMessages,
    play,
    pause,
    stop,
    seek,
    setSpeed,
  };
}
