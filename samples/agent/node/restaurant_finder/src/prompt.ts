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

export const ROLE_DESCRIPTION =
  'You are a helpful restaurant finding assistant. Your final output MUST be an A2UI UI definition.';

export const UI_DESCRIPTION_DIRECT_JSON = `
-   If the query is for a list of restaurants, use the restaurant data you have already received from the \`get_restaurants\` tool to populate the \`updateDataModel\` message.
-   IMPORTANT: When using updateDataModel to update items, you MUST specify \`path: "/items"\` in \`updateDataModel\`, and the \`value\` MUST be an array of restaurants.
-   IMPORTANT: Always specify the path when using updateDataModel. The part message is ignored when the path is missing.
-   If the number of restaurants is 5 or fewer, you MUST use the \`SINGLE_COLUMN_LIST_EXAMPLE\` template.
-   If the number of restaurants is more than 5, you MUST use the \`TWO_COLUMN_LIST_EXAMPLE\` template.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), you MUST use the \`BOOKING_FORM_EXAMPLE\` template.
-   If the query is a booking submission (e.g., "User submitted a booking..."), you MUST use the \`CONFIRMATION_EXAMPLE\` template.
`;

export const UI_DESCRIPTION_EXPRESS = `
-   If the query is for a list of restaurants, use the restaurant data you have already received from the \`get_restaurants\` tool to populate the \`updateDataModel\` message.
-   If the number of restaurants is 5 or fewer, you MUST use the \`SINGLE_COLUMN_LIST_EXAMPLE\` template.
-   If the number of restaurants is more than 5, you MUST use the \`TWO_COLUMN_LIST_EXAMPLE\` template.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), you MUST use the \`BOOKING_FORM_EXAMPLE\` template.
-   If the query is a booking submission (e.g., "User submitted a booking..."), you MUST use the \`CONFIRMATION_EXAMPLE\` template.
`;

/** Returns the UI description for the chosen format. */
export function getUiDescription(format: 'direct_json' | 'express'): string {
  return format === 'express' ? UI_DESCRIPTION_EXPRESS : UI_DESCRIPTION_DIRECT_JSON;
}

/**
 * Builds the system prompt around the SDK's prompt snippet.
 *
 * The snippet tells the model how to write A2UI for the negotiated catalogs: the format's
 * rules, the catalog schemas and the examples. The role and the UI description around it
 * are this agent's own.
 */
export function buildSystemPrompt(
  format: 'direct_json' | 'express',
  promptSnippet: string,
): string {
  return [ROLE_DESCRIPTION, getUiDescription(format), promptSnippet].join('\n\n');
}

/** The answer when no attempt produced valid A2UI. */
export const FALLBACK_TEXT =
  "I'm sorry, I'm having trouble generating the interface for that request right now. Please try again in a moment.";

/** The follow-up query sent after a response failed validation. */
export function retryQuery(
  format: 'direct_json' | 'express',
  error: string,
  query: string,
): string {
  return format === 'direct_json'
    ? `Your previous response was invalid. Validation failed: ${error}. You MUST generate a valid response that strictly follows the A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI messages. Ensure each JSON part is wrapped in '<a2ui-json>' and '</a2ui-json>' tags. Please retry the original request: '${query}'`
    : `Your previous response was invalid. Validation failed: ${error}. You MUST generate a valid response that is valid A2UI Express wrapped in the '<a2ui>' and '</a2ui>' tags. Please retry the original request: '${query}'`;
}
