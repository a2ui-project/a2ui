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

import type {Message} from '@a2a-js/sdk';

import type {VersionProfile} from './versions.js';

/** What the agent needs from one inbound A2A message. */
export interface UserQuery {
  /** The text sent to the model. */
  query: string;
  /** The name of the UI action the user took, if the message carries one. */
  actionName?: string;
  /** False when the client wants every part in the final status instead of streamed. */
  useStreaming: boolean;
}

/**
 * Turns an inbound message into a model query. UI actions from the restaurant surfaces
 * become the sentences the prompt expects; plain text is passed through.
 */
export function parseUserQuery(message: Message, profile: VersionProfile): UserQuery {
  let useStreaming = true;
  let uiEventPart: Record<string, unknown> | undefined;

  for (const part of message.parts ?? []) {
    if ('data' in part && typeof part.data === 'object' && part.data !== null) {
      const dataMap = part.data as Record<string, unknown>;
      if (typeof dataMap.useStreaming === 'boolean') {
        useStreaming = dataMap.useStreaming;
      }
      if (
        dataMap.version === profile.version &&
        dataMap.action &&
        typeof dataMap.action === 'object'
      ) {
        uiEventPart = dataMap.action as Record<string, unknown>;
      } else if (dataMap.userAction && typeof dataMap.userAction === 'object') {
        uiEventPart = dataMap.userAction as Record<string, unknown>;
      }
    }
  }

  if (!uiEventPart) {
    const texts: string[] = [];
    for (const part of message.parts ?? []) {
      if ('text' in part && typeof part.text === 'string' && part.text) {
        texts.push(part.text);
      }
    }
    return {query: texts.join('') || 'Hello!', useStreaming};
  }

  const actionName = typeof uiEventPart.name === 'string' ? uiEventPart.name : undefined;
  const ctx =
    typeof uiEventPart.context === 'object' && uiEventPart.context !== null
      ? (uiEventPart.context as Record<string, unknown>)
      : {};

  let query: string;
  if (actionName === 'book_restaurant') {
    const restaurantName = (ctx.restaurantName as string) ?? 'Unknown Restaurant';
    const address = (ctx.address as string) ?? 'Address not provided';
    const imageUrl = (ctx.imageUrl as string) ?? '';
    query = `USER_WANTS_TO_BOOK: ${restaurantName}, Address: ${address}, ImageURL: ${imageUrl}`;
  } else if (actionName === 'submit_booking') {
    const restaurantName = (ctx.restaurantName as string) ?? 'Unknown Restaurant';
    const partySize = ctx.partySize !== undefined ? String(ctx.partySize) : 'Unknown Size';
    const reservationTime = (ctx.reservationTime as string) ?? 'Unknown Time';
    const dietary = (ctx.dietary as string) ?? 'None';
    const imageUrl = (ctx.imageUrl as string) ?? '';
    query = `User submitted a booking for ${restaurantName} for ${partySize} people at ${reservationTime} with dietary requirements: ${dietary}. The image URL is ${imageUrl}`;
  } else {
    query = `User submitted an event: ${actionName} with data: ${JSON.stringify(ctx)}`;
  }
  return {query, actionName, useStreaming};
}
