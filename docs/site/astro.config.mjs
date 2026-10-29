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

// @ts-check
import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import {remarkA2uiIncludes} from './src/plugins/remark-a2ui-includes.mjs';

export default defineConfig({
  site: process.env.ASTRO_SITE || 'https://a2ui.org',
  base: process.env.ASTRO_BASE || undefined,
  markdown: {
    remarkPlugins: [remarkA2uiIncludes],
  },
  integrations: [
    starlight({
      title: 'A2UI',
      description:
        'The open Agent-to-UI protocol and SDK suite for native, stateful generative user interfaces.',
      logo: {
        light: './src/assets/A2UI_dark.svg',
        dark: './src/assets/A2UI_light.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/a2ui-project/a2ui',
        discord: 'https://discord.gg/6fS2326966',
      },
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.googleapis.com',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: true,
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
          },
        },
      ],
      components: {
        Header: './src/components/StarlightHeader.astro',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Navigation',
          items: [
            {
              label: '← Back to Overview',
              link: `${(process.env.ASTRO_BASE || '').replace(/\/$/, '')}/`,
            },
          ],
        },
        {
          label: 'Getting Started',
          items: [{label: '5-Minute Quickstart (Pilot)', slug: 'quickstart'}],
        },
        {
          label: 'Specifications',
          items: [
            {
              label: 'v1.0 Protocol Spec (Pilot)',
              slug: 'specification/v1.0-a2ui',
              badge: {text: 'Candidate', variant: 'tip'},
            },
          ],
        },
      ],
    }),
  ],
});
