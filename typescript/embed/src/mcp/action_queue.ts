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

/** The most `tools/call` requests an app may have in flight; hosts reject calls beyond it. */
export const MAX_IN_FLIGHT_CALLS = 4;

/**
 * Runs asynchronous tasks with at most `limit` of them in flight, queueing the rest in order.
 */
export class TaskQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  /**
   * @param limit The most tasks that may run at once.
   * @param onBusyChange Called with `true` when the first task starts and with `false` when the
   *     last one settles.
   */
  constructor(
    private readonly limit: number,
    private readonly onBusyChange?: (busy: boolean) => void,
  ) {}

  /** Runs `task` as soon as fewer than `limit` tasks are in flight. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running === 0 && this.waiting.length === 0) {
      this.onBusyChange?.(true);
    }
    if (this.running >= this.limit) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const next = this.waiting.shift();
      if (next) {
        next();
      } else if (this.running === 0) {
        this.onBusyChange?.(false);
      }
    }
  }
}
