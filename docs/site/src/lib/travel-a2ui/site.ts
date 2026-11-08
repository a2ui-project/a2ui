/**
 * Copyright 2024 Google LLC
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

// Every URL the Travel A2UI quickstart hands out, in one place.
//
// Agents are given absolute URLs (a prompt pasted into a terminal has no page
// to be relative to), so they are built from the configured site and base,
// which keeps them right on pull request previews too.

const site = (import.meta.env.SITE ?? '').replace(/\/$/, '');
const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** A path inside this site, as an absolute URL. */
export const absolute = (path: string) => `${site}${base}/${path.replace(/^\//, '')}`;

/** A path inside this site, relative to the origin. */
export const local = (path: string) => `${base}/${path.replace(/^\//, '')}`;

/** The sample lives in A2UI Labs. */
export const LABS_REPO = 'https://github.com/a2ui-project/labs';
export const SAMPLE_DIR = 'samples/travel-a2ui';
export const REPO = `${LABS_REPO}/tree/main/${SAMPLE_DIR}`;
export const LIVE_DEMO = 'https://travel-a2ui-vy7stnte2a-uc.a.run.app';
export const FLUTTER_DEMO = `${LIVE_DEMO}/flutter/`;
export const DEPLOY = `https://deploy.cloud.run/?git_repo=${LABS_REPO}&dir=${SAMPLE_DIR}`;
export const BUILD_YOUR_OWN = `${REPO}#build-one-of-your-own`;

/** The pages of this quickstart. */
export const OVERVIEW_PATH = 'quickstart/travel-a2ui/';
export const STEP_BY_STEP_PATH = 'quickstart/travel-a2ui/step-by-step/';
export const STEP_BY_STEP = local(STEP_BY_STEP_PATH);

/** What a coding agent follows, served raw. `agent.md` asks which app first. */
export const PROMPT_PATH = 'quickstart/travel-a2ui/agent.md';
export const PROMPT_WEB = 'quickstart/travel-a2ui/agent/web.md';
export const PROMPT_MOBILE = 'quickstart/travel-a2ui/agent/mobile.md';

/** The prompts the quickstart button copies: one line, one URL each. */
export const QUICKSTART_PROMPTS = [
  {
    app: 'Web app',
    stack: 'Python + React',
    prompt: `Follow the steps at ${absolute(PROMPT_WEB)} to set up the A2UI quickstart web app and explain it to me.`,
    guide: PROMPT_WEB,
  },
  {
    app: 'Mobile app',
    stack: 'Python + Flutter',
    prompt: `Follow the steps at ${absolute(PROMPT_MOBILE)} to set up the A2UI quickstart mobile app and explain it to me.`,
    guide: PROMPT_MOBILE,
  },
];

/** The A2UI documentation on this site, one entry per concept the tour teaches. */
export const A2UI = {
  home: local('/'),
  overview: local('concepts/overview/'),
  messages: local('concepts/messages/'),
  catalogs: local('concepts/catalogs/'),
  ownCatalog: local('guides/defining-a-catalog/'),
  dataBinding: local('concepts/data-binding/'),
  actions: local('concepts/actions-and-functions/'),
  spec: local('specification/v1.0-a2ui/'),
  renderers: local('ecosystem/renderers/'),
  glossary: local('concepts/glossary/'),
};
