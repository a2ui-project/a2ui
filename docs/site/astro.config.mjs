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
import fs from 'node:fs';

import starlight from '@astrojs/starlight';
import {defineConfig} from 'astro/config';

import {normalizeBasePrefix} from './src/lib/spec-schemas.mjs';
import {googleAnalytics} from './src/plugins/google-analytics.mjs';
import {rehypeLocalDocAssets} from './src/plugins/rehype-local-doc-assets.mjs';
import {rehypeWrapTables} from './src/plugins/rehype-wrap-tables.mjs';
import {remarkA2uiIncludes} from './src/plugins/remark-a2ui-includes.mjs';

function extractHastText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  return Array.isArray(node.children) ? node.children.map(extractHastText).join('') : '';
}

function rehypePreserveJsonHeadingIds() {
  return tree => {
    const walk = node => {
      if (node?.type === 'element' && /^h[2-4]$/.test(node.tagName)) {
        const text = extractHastText(node).trim();
        if (/^[a-z0-9_.-]+\.json$/i.test(text)) {
          node.properties = {...node.properties, id: text};
        }
      }
      if (Array.isArray(node?.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}

const basePrefix = normalizeBasePrefix(process.env.ASTRO_BASE);
const docAssetsManifest = JSON.parse(
  fs.readFileSync(new URL('./assets-manifest.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  site: process.env.ASTRO_SITE || 'https://a2ui.org',
  base: process.env.ASTRO_BASE || undefined,
  redirects: {
    '/preview': `${basePrefix}/`,
    '/gallery': `${basePrefix}/built-with-a2ui/`,
    '/showcase': `${basePrefix}/built-with-a2ui/`,
    '/build-with-a2ui': `${basePrefix}/built-with-a2ui/`,
    '/specification/v0.9-a2ui': `${basePrefix}/specification/v0.9.1-a2ui/`,
    '/specification/v0.9-evolution-guide': `${basePrefix}/specification/v0.9.1-evolution-guide/`,
    '/concepts/actions': `${basePrefix}/concepts/actions-and-functions/`,
    '/concepts/agent-sdks': `${basePrefix}/concepts/sdks/#agent-sdk`,
    '/concepts/components': `${basePrefix}/concepts/catalogs/`,
    '/concepts/data-flow': `${basePrefix}/concepts/data-binding/`,
    '/concepts/renderer-sdks': `${basePrefix}/concepts/sdks/#renderer-sdk`,
    '/concepts/transports': `${basePrefix}/concepts/messages/`,
    '/concepts/macros': `${basePrefix}/guides/macros/`,
    '/guides/a2ui_over_mcp': `${basePrefix}/guides/a2ui-over-mcp/`,
    '/guides/defining-your-own-catalog': `${basePrefix}/guides/defining-a-catalog/`,
    '/guides/client-setup': `${basePrefix}/guides/client-integration/`,
    '/guides/agent-development': `${basePrefix}/guides/agent-integration/`,
    '/guides/guide_a2ui_dynamic_mcp': `${basePrefix}/guides/a2ui-in-mcp-apps/`,
    '/guides/mcp-apps-in-a2ui-surface': `${basePrefix}/guides/mcp-apps-in-a2ui/`,
    '/introduction/where-is-it-used': `${basePrefix}/built-with-a2ui/`,
    '/catalogs': `${basePrefix}/concepts/catalogs/`,
    '/transports': `${basePrefix}/concepts/messages/`,
    '/actions': `${basePrefix}/concepts/actions-and-functions/`,
    '/renderers': `${basePrefix}/concepts/sdks/#renderer-sdk`,
    '/agents': `${basePrefix}/concepts/sdks/#agent-sdk`,
    '/community': `${basePrefix}/ecosystem/renderers/`,
    '/specification/v0.8-a2ui': `${basePrefix}/specification/v1.0-a2ui/`,
    '/specification/v0.8-a2a-extension': `${basePrefix}/specification/v1.0-a2ui-extension-specification/`,
    '/specification/v0.8-custom-catalog-changes': `${basePrefix}/specification/v1.0-a2ui/`,
    '/specification/v0.8/schemas': `${basePrefix}/specification/v1.0/schemas/`,
    '/consultants': `${basePrefix}/get-help/#consultants`,
    // Pages from the MkDocs site that blog posts and other sites still link to.
    '/composer': `${basePrefix}/quickstart/#other-fast-paths`,
    '/composer/composer_renderer_integration': `${basePrefix}/guides/client-integration/`,
    '/ecosystem/a2ui-in-the-world': `${basePrefix}/built-with-a2ui/`,
    '/ecosystem/community': `${basePrefix}/ecosystem/renderers/`,
    '/guides/a2ui-with-any-agent-framework': `${basePrefix}/guides/agent-integration/#ag-ui-and-copilotkit`,
    '/guides/authoring-components': `${basePrefix}/guides/defining-a-catalog/`,
    '/guides/renderer-development': `${basePrefix}/concepts/sdks/#renderer-sdk`,
    '/guides/theming': `${basePrefix}/guides/client-integration/#customize-basic-catalog-theme-tokens-on-web`,
    '/introduction/agent-ui-ecosystem': `${basePrefix}/concepts/overview/`,
    '/introduction/how-to-use': `${basePrefix}/quickstart/`,
    '/introduction/what-is-a2ui': `${basePrefix}/concepts/overview/`,
    '/introduction/who-is-it-for': `${basePrefix}/`,
    '/reference/agents': `${basePrefix}/concepts/sdks/#agent-sdk`,
    '/reference/components': `${basePrefix}/specification/v1.0-basic-catalog-implementation-guide/`,
    '/reference/messages': `${basePrefix}/concepts/messages/`,
    '/reference/renderers': `${basePrefix}/concepts/sdks/#renderer-sdk`,
    '/specification/proposals/atom/a2ui_atom': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/elemental/a2ui_elemental': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/elemental/implementation_plan': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/express': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/express/a2ui_express': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/express/create_surface_design': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/express/express_dsl_examples': `${basePrefix}/concepts/inference-formats/`,
    '/specification/proposals/user_initiated_functions': `${basePrefix}/concepts/actions-and-functions/`,
  },
  markdown: {
    remarkPlugins: [remarkA2uiIncludes],
    rehypePlugins: [
      rehypeWrapTables,
      rehypePreserveJsonHeadingIds,
      [rehypeLocalDocAssets, {manifest: docAssetsManifest, basePrefix}],
    ],
  },
  integrations: [
    googleAnalytics('G-YX9TPV8DCC'),
    starlight({
      title: 'A2UI',
      description:
        'The open A2UI (Agent to User Interface) protocol and SDK suite for native, stateful generative user interfaces.',
      logo: {
        light: './src/assets/A2UI_dark.svg',
        dark: './src/assets/A2UI_light.svg',
        replacesTitle: false,
      },
      favicon: '/assets/favicon.svg',
      social: {
        github: 'https://github.com/a2ui-project/a2ui',
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
            href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,400..700;1,400..700&display=swap',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'alternate',
            type: 'text/markdown',
            href: `${basePrefix}/llms.txt`,
            title: 'A2UI documentation index for LLMs',
          },
        },
      ],
      components: {
        Header: './src/components/StarlightHeader.astro',
      },
      customCss: ['./src/styles/tokens.css', './src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            {
              label: 'Quickstart',
              slug: 'quickstart',
            },
            {
              label: 'Step-by-Step Walkthrough',
              slug: 'quickstart/step-by-step',
            },
            {
              label: 'Playground ↗',
              link: 'https://go.copilotkit.ai/a2ui-playground',
              attrs: {target: '_blank', rel: 'noopener noreferrer'},
            },
          ],
        },
        {
          label: 'Concepts',
          items: [
            {
              label: 'Overview: How A2UI Works',
              slug: 'concepts/overview',
            },
            {
              label: 'Messages',
              slug: 'concepts/messages',
            },
            {
              label: 'Catalogs',
              slug: 'concepts/catalogs',
            },
            {
              label: 'Data Model and Data Binding',
              slug: 'concepts/data-binding',
            },
            {
              label: 'Actions, Events and Functions',
              slug: 'concepts/actions-and-functions',
            },
            {
              label: 'Inference Formats',
              slug: 'concepts/inference-formats',
            },
            {
              label: 'SDKs',
              slug: 'concepts/sdks',
            },
            {
              label: 'Glossary',
              slug: 'concepts/glossary',
            },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'How to Integrate A2UI into a Client',
              slug: 'guides/client-integration',
            },
            {
              label: 'How to Integrate A2UI into an Agent',
              slug: 'guides/agent-integration',
            },
            {
              label: 'How to Define a Catalog',
              slug: 'guides/defining-a-catalog',
            },
            {
              label: 'Using Macros',
              slug: 'guides/macros',
            },
            {
              label: 'Model Context Protocol (MCP)',
              collapsed: true,
              items: [
                {
                  label: 'Overview',
                  slug: 'guides/mcp-overview',
                },
                {
                  label: 'Call MCP Tools from A2UI',
                  slug: 'guides/mcp-catalog',
                },
                {
                  label: 'Serve A2UI Layouts from an MCP Server',
                  slug: 'guides/a2ui-over-mcp',
                },
                {
                  label: 'Embed MCP Apps in A2UI Surfaces',
                  slug: 'guides/mcp-apps-in-a2ui',
                },
                {
                  label: 'Render A2UI Inside an MCP App',
                  slug: 'guides/a2ui-in-mcp-apps',
                },
              ],
            },
            {
              label: 'Authoring Universal Web Components',
              slug: 'guides/authoring-universal-components',
            },
          ],
        },
        {
          label: 'Ecosystem',
          items: [
            {
              label: 'Roadmap',
              slug: 'roadmap',
            },
            {
              label: 'Community Projects',
              slug: 'ecosystem/renderers',
            },
            {
              label: 'Get Help',
              link: '/get-help/',
            },
          ],
        },
        {
          label: 'Specifications',
          items: [
            {
              label: 'v1.0',
              badge: {text: 'Current', variant: 'success'},
              items: [
                {
                  label: 'Protocol Specification',
                  slug: 'specification/v1.0-a2ui',
                },
                {
                  label: 'JSON Schemas',
                  slug: 'specification/v1.0/schemas',
                },
                {
                  label: 'Basic Catalog Guide',
                  slug: 'specification/v1.0-basic-catalog-implementation-guide',
                },
                {
                  label: 'A2A Extension',
                  slug: 'specification/v1.0-a2ui-extension-specification',
                },
                {
                  label: 'Evolution Guide',
                  slug: 'specification/v1.0-evolution-guide',
                },
              ],
            },
            {
              label: 'v0.9.1',
              collapsed: true,
              items: [
                {
                  label: 'Protocol Specification',
                  slug: 'specification/v0.9.1-a2ui',
                },
                {
                  label: 'JSON Schemas',
                  slug: 'specification/v0.9.1/schemas',
                },
                {
                  label: 'Basic Catalog Guide',
                  slug: 'specification/v0.9.1-basic-catalog-implementation-guide',
                },
                {
                  label: 'A2A Extension',
                  slug: 'specification/v0.9.1-a2ui-extension-specification',
                },
                {
                  label: 'Evolution Guide',
                  slug: 'specification/v0.9.1-evolution-guide',
                },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
