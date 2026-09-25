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
 * Sizing of a frame component: resize requests coming from the embedded app, and the container
 * dimensions the host reports back to it.
 */

/** Limits and timing of {@link FrameSizing}; the defaults are the ones of the reference host. */
export interface FrameSizingOptions {
  readonly frame: HTMLIFrameElement;
  /** Smallest width applied, in CSS pixels. */
  readonly minWidth?: number;
  /** Largest width applied, in CSS pixels. */
  readonly maxWidth?: number;
  /** Smallest height applied, in CSS pixels. */
  readonly minHeight?: number;
  /** Largest height applied, in CSS pixels. */
  readonly maxHeight?: number;
  /** Changes smaller than this many pixels are ignored once a size has been applied. */
  readonly threshold?: number;
  /** Requests are coalesced and applied at most once per this many milliseconds. */
  readonly throttleMs?: number;
}

/** Container dimensions reported to the embedded app. */
export interface FrameHostContext {
  readonly containerDimensions: {
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Applies resize requests from the embedded app to the frame and its parent element, so a frame
 * can grow with its content instead of showing scrollbars.
 *
 * Three protections keep a misbehaving app from disrupting the host layout: dimensions are
 * clamped to a range, changes below a threshold are ignored, and requests are throttled. Within a
 * throttle window the latest request wins.
 */
export class FrameSizing {
  private readonly frame: HTMLIFrameElement;
  private readonly minWidth: number;
  private readonly maxWidth: number;
  private readonly minHeight: number;
  private readonly maxHeight: number;
  private readonly threshold: number;
  private readonly throttleMs: number;

  private pending: {width?: number; height?: number} | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWidth?: number;
  private lastHeight?: number;

  constructor(options: FrameSizingOptions) {
    this.frame = options.frame;
    this.minWidth = options.minWidth ?? 200;
    this.maxWidth = options.maxWidth ?? 3000;
    this.minHeight = options.minHeight ?? 100;
    this.maxHeight = options.maxHeight ?? 2000;
    this.threshold = options.threshold ?? 5;
    this.throttleMs = options.throttleMs ?? 100;
  }

  /** Requests new dimensions; either may be omitted to leave it unchanged. */
  requestSize(width?: number, height?: number): void {
    this.pending = {width, height};
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      const request = this.pending;
      this.pending = null;
      if (request) {
        this.apply(request.width, request.height);
      }
    }, this.throttleMs);
  }

  /** Cancels a pending request. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private apply(width?: number, height?: number): void {
    const targetWidth =
      width !== undefined ? Math.max(this.minWidth, Math.min(width, this.maxWidth)) : undefined;
    const targetHeight =
      height !== undefined ? Math.max(this.minHeight, Math.min(height, this.maxHeight)) : undefined;
    const parent = this.frame.parentElement;

    if (targetWidth !== undefined && this.exceedsThreshold(targetWidth, this.lastWidth)) {
      this.frame.style.width = `${targetWidth}px`;
      if (parent) {
        parent.style.width = `${targetWidth}px`;
      }
      this.lastWidth = targetWidth;
    }

    if (targetHeight !== undefined && this.exceedsThreshold(targetHeight, this.lastHeight)) {
      this.frame.style.height = `${targetHeight}px`;
      if (parent) {
        parent.style.height = `${targetHeight}px`;
        parent.style.aspectRatio = 'auto';
      }
      this.lastHeight = targetHeight;
    }
  }

  private exceedsThreshold(target: number, last: number | undefined): boolean {
    return last === undefined || Math.abs(target - last) >= this.threshold;
  }
}

/** Reads the frame's current dimensions as the host context sent during initialization. */
export function measureHostContext(frame: Element): FrameHostContext {
  const rect = frame.getBoundingClientRect();
  return {containerDimensions: {width: rect.width, height: rect.height}};
}

/**
 * Reports the frame's dimensions to `onChange` whenever they change. Returns a function that
 * stops observing.
 */
export function observeHostContext(
  frame: Element,
  onChange: (context: FrameHostContext) => void,
): () => void {
  const observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry) {
      const {width, height} = entry.contentRect;
      onChange({containerDimensions: {width, height}});
    }
  });
  observer.observe(frame);
  return () => {
    observer.disconnect();
  };
}
