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

/** Where the sample lives: A2UI Labs, on its main branch. */
export const LABS_REPO = 'https://github.com/a2ui-project/labs';
export const SAMPLE_DIR = 'samples/travel-a2ui';
export const REPO = `${LABS_REPO}/tree/main/${SAMPLE_DIR}`;
export const BUILD_YOUR_OWN = `${REPO}#build-one-of-your-own`;

/**
 * Deploying the sample to Cloud Run: Cloud Shell, with the sample cloned and
 * its guide (`docs/cloud-shell.md`) open beside the terminal. Everything runs
 * as the visitor, in their own project.
 */
export const CLOUD_SHELL =
  'https://shell.cloud.google.com/cloudshell/editor' +
  `?cloudshell_git_repo=${LABS_REPO}&cloudshell_git_branch=main` +
  `&cloudshell_workspace=${SAMPLE_DIR}&cloudshell_tutorial=docs/cloud-shell.md` +
  '&show=ide%2Cterminal';
export const DEPLOY_DOCS = `${LABS_REPO}/blob/main/${SAMPLE_DIR}/docs/deploying.md`;

/** The two commands that get the code. */
export const CLONE = `git clone ${LABS_REPO}\ncd labs/${SAMPLE_DIR}`;

/** The pages of this quickstart. */
export const OVERVIEW_PATH = 'quickstart/';
export const OVERVIEW = local(OVERVIEW_PATH);
export const STEP_BY_STEP_PATH = 'quickstart/step-by-step/';
export const STEP_BY_STEP = local(STEP_BY_STEP_PATH);

/** What a coding agent follows, served raw: web and mobile, or one of them. */
export const PROMPT_PATH = 'quickstart/agent.md';
export const PROMPT_WEB = 'quickstart/agent/web.md';
export const PROMPT_MOBILE = 'quickstart/agent/mobile.md';

/** The prompts the quickstart button copies: one line, one URL each. The first is the default. */
export const QUICKSTART_PROMPTS = [
  {
    id: 'both',
    app: 'Web + Mobile',
    stack: 'Python + React + Flutter',
    prompt: `Follow the steps at ${absolute(PROMPT_PATH)} to set up the A2UI quickstart web and mobile apps and explain them to me.`,
    guide: PROMPT_PATH,
  },
  {
    id: 'web',
    app: 'Web only',
    stack: 'Python + React',
    prompt: `Follow the steps at ${absolute(PROMPT_WEB)} to set up the A2UI quickstart web app and explain it to me.`,
    guide: PROMPT_WEB,
  },
  {
    id: 'mobile',
    app: 'Mobile only',
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
