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

import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import type {MessageProcessor} from '@a2ui/web_core';

import type {Turn} from '../conversation';
import {UnderTheHood} from './UnderTheHood';

export function TurnView({
  turn,
  processor,
}: {
  turn: Turn;
  processor: MessageProcessor<ReactCatalogComponent>;
}) {
  if (turn.kind === 'user') {
    return (
      <div className={`ln-turn ln-user${turn.viaAction ? ' ln-via-action' : ''}`}>
        <div className="ln-bubble" data-testid="user-turn">
          {turn.viaAction && <span className="ln-action-mark">▸ </span>}
          {turn.text}
        </div>
      </div>
    );
  }
  if (turn.pending) {
    return (
      <div className="ln-turn ln-assistant" data-testid="assistant-pending">
        <div className="ln-thinking" aria-live="polite">
          <span className="ln-eq" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Looking it up…
        </div>
      </div>
    );
  }
  const surface = turn.surfaceId ? processor.model.getSurface(turn.surfaceId) : undefined;
  return (
    <div className="ln-turn ln-assistant" data-testid="assistant-turn">
      {turn.failure && <div className="ln-failure">Request failed: {turn.failure}</div>}
      {turn.text && <p className="ln-assistant-text">{turn.text}</p>}
      {surface && (
        <div className="ln-surface" data-testid="surface" data-surface-id={surface.id}>
          <A2uiSurface surface={surface} />
        </div>
      )}
      {turn.debug && <UnderTheHood debug={turn.debug} messages={turn.messages ?? []} />}
    </div>
  );
}
