/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Part} from '@a2a-js/sdk';
import {RendererComponent} from '@a2a_chat_canvas/a2a-renderer/types';
import {ChatService} from '@a2a_chat_canvas/services/chat-service';
import {UiMessageContent} from '@a2a_chat_canvas/types/ui-message';
import {isA2aDataPart} from '@a2a_chat_canvas/utils/type-guards';
import {Surface} from '@a2ui/angular';
import {SurfaceComponent as SurfaceV09} from '@a2ui/angular/v0_9';
import * as Types from '@a2ui/web_core/types/types';
import {A2uiMessage as A2uiMessageV09, CreateSurfaceMessage} from '@a2ui/web_core/v0_9';
import {ChangeDetectionStrategy, Component, computed, inject, input} from '@angular/core';

/**
 * Component responsible for rendering an A2UI surface embedded within an A2A message part.
 * Supports both A2UI v0.8 and v0.9 rendering pipelines:
 * - For v0.8 (legacy): Extracts the surface ID from the 'beginRendering' message and renders using the legacy `Surface` component.
 * - For v0.9 (latest): Extracts the surface ID from the 'createSurface' message and renders using the `SurfaceComponent` from the v0.9 package.
 */
@Component({
  selector: 'a2ui-data-part',
  templateUrl: './a2ui-data-part.html',
  styleUrl: './a2ui-data-part.scss',
  imports: [Surface, SurfaceV09],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class A2uiDataPart implements RendererComponent {
  /** The UiMessageContent containing the A2A data part with the embedded A2UI message. */
  readonly uiMessageContent = input.required<UiMessageContent>();

  /** Service for managing chat interactions and accessing A2UI surfaces. */
  private readonly chatService = inject(ChatService);

  protected readonly a2uiSurfaceId = computed(() => {
    const part = this.uiMessageContent().data as Part;
    if (!isA2aDataPart(part) || typeof part.data !== 'object' || !part.data) {
      return undefined;
    }

    if (this.isV08()) {
      const data = part.data as Types.ServerToClientMessage;
      return data.beginRendering?.surfaceId;
    } else {
      // We only care about CreateSurfaceMessage for identifying the surface start.
      // If it is another v0.9 message, createSurface will be undefined.
      const data = part.data as unknown as CreateSurfaceMessage;
      return data.createSurface?.surfaceId;
    }

    return undefined;
  });

  /** Retrieves the A2UI surface data from the ChatService using the computed surface ID. */
  protected readonly a2uiSurface = computed(() => {
    const surfaceId = this.a2uiSurfaceId();
    if (!surfaceId) {
      return undefined;
    }

    return this.chatService.a2uiSurfaces().get(surfaceId);
  });

  /** Determines if the embedded surface is using the v0.8 protocol. */
  protected readonly isV08 = computed(() => {
    const part = this.uiMessageContent().data as Part;
    if (isA2aDataPart(part) && part.data && typeof part.data === 'object') {
      // 'beginRendering' is the v0.8 lifecycle start message.
      return 'beginRendering' in part.data;
    }
    return false;
  });
}
