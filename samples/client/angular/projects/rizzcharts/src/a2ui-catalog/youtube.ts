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

import {DynamicComponent} from '@a2ui/angular';
import * as Primitives from '@a2ui/web_core/types/primitives';
import * as Types from '@a2ui/web_core/types/types';
import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';

@Component({
  selector: 'a2ui-youtube',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      padding: 8px;
    }

    .youtube-container {
      background-color: var(--mat-sys-surface-container);
      border-radius: 8px;
      border: 1px solid var(--mat-sys-surface-container-high);
      padding: 16px;
      max-width: 800px;
    }

    .youtube-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .youtube-header h3 {
      margin: 0;
      font-size: 18px;
      color: var(--mat-sys-on-surface);
    }

    .video-wrapper {
      position: relative;
      width: 100%;
      padding-bottom: 56.25%; /* 16:9 aspect ratio */
      border-radius: 8px;
      overflow: hidden;
    }

    iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
    }
  `,
  template: `
    @if (resolvedVideoId()) {
      <div class="youtube-container">
        @if (resolvedTitle()) {
          <div class="youtube-header">
            <h3>{{ resolvedTitle() }}</h3>
          </div>
        }
        <div class="video-wrapper">
          <iframe
            [src]="safeUrl()"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    }
  `,
})
export class YouTube extends DynamicComponent<Types.CustomNode> {
  readonly videoId = input.required<Primitives.StringValue | null>();
  protected readonly resolvedVideoId = computed(() => this.resolvePrimitive(this.videoId()));

  readonly title = input<Primitives.StringValue | null>();
  protected readonly resolvedTitle = computed(() => this.resolvePrimitive(this.title() ?? null));

  readonly autoplay = input<Primitives.BooleanValue | null>();
  protected readonly resolvedAutoplay = computed(() =>
    this.resolvePrimitive(this.autoplay() ?? null),
  );

  private static readonly YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

  protected readonly safeUrl = computed((): SafeResourceUrl | null => {
    const id = this.resolvedVideoId();
    if (!id) return null;

    // Validate video ID format before constructing URL
    if (!YouTube.YOUTUBE_ID_REGEX.test(id)) {
      console.error('Invalid YouTube video ID received from agent:', id);
      return null;
    }

    const autoplay = this.resolvedAutoplay() ? '1' : '0';
    const url = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=${autoplay}&rel=0`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor(private sanitizer: DomSanitizer) {
    super();
  }
}
