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
 * Conversation state: the turns shown in the feed and the A2UI message
 * processor that owns every surface the agent creates (one per turn).
 */

import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {MessageProcessor} from '@a2ui/web_core';
import type {ReactCatalogComponent} from '@a2ui/react';
import {useCallback, useEffect, useState} from 'react';

import {api, type AgentTurn, type TurnDebug} from './api';
import {musicCatalog} from './catalog/music_catalog';

export interface UserTurn {
  kind: 'user';
  id: string;
  text: string;
  viaAction: boolean;
}

export interface AssistantTurn {
  kind: 'assistant';
  id: string;
  pending: boolean;
  text?: string;
  surfaceId?: string;
  debug?: TurnDebug;
  messages?: AgentTurn['messages'];
  failure?: string;
}

export type Turn = UserTurn | AssistantTurn;

let nextId = 0;
const newId = () => `t${++nextId}`;

export function useConversation() {
  const [conversationId] = useState(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [processor] = useState(
    () => new MessageProcessor<ReactCatalogComponent>([basicCatalog, musicCatalog]),
  );

  const run = useCallback(
    async (userText: string, viaAction: boolean, call: () => Promise<AgentTurn>) => {
      const pendingId = newId();
      setBusy(true);
      setTurns(t => [
        ...t,
        {kind: 'user', id: newId(), text: userText, viaAction},
        {kind: 'assistant', id: pendingId, pending: true},
      ]);
      let update: AssistantTurn;
      try {
        const turn = await call();
        if (turn.messages.length) processor.processMessages(turn.messages);
        update = {
          kind: 'assistant',
          id: pendingId,
          pending: false,
          text: turn.text,
          surfaceId: turn.messages.length ? turn.surfaceId : undefined,
          debug: turn.debug,
          messages: turn.messages,
        };
      } catch (e) {
        update = {kind: 'assistant', id: pendingId, pending: false, failure: String(e)};
      }
      setTurns(t => t.map(turn => (turn.id === pendingId ? update : turn)));
      setBusy(false);
    },
    [processor],
  );

  const sendPrompt = useCallback(
    (prompt: string) => run(prompt, false, () => api.chat(conversationId, prompt)),
    [conversationId, run],
  );

  // Buttons in any surface dispatch v1.0 event actions; send them to the agent.
  useEffect(() => {
    const subscription = processor.model.onAction.subscribe(action => {
      void run(action.userMessage ?? action.name, true, () =>
        api.action(conversationId, {
          name: action.name,
          context: action.context,
          userMessage: action.userMessage,
        }),
      );
    });
    return () => subscription.unsubscribe();
  }, [conversationId, processor, run]);

  return {turns, busy, sendPrompt, processor};
}
