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
        {
          tag: 'script',
          attrs: {
            type: 'module',
          },
          content: `const renderMermaid = async () => { for (const pre of document.querySelectorAll('pre[data-language="mermaid"]')) { const code = (pre.querySelector('code')?.innerText || pre.innerText).trim(); const div = document.createElement('div'); div.className = 'mermaid-rendered not-content'; div.dataset.mermaidSource = code; (pre.closest('.expressive-code') || pre).replaceWith(div); } const blocks = document.querySelectorAll('.mermaid-rendered[data-mermaid-source]'); if (!blocks.length) return; const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'); const isDark = document.documentElement.getAttribute('data-theme') !== 'light'; mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', fontFamily: 'inherit' }); for (let i = 0; i < blocks.length; i++) { const div = blocks[i]; const code = div.dataset.mermaidSource; if (!code) continue; try { const id = 'mermaid-svg-' + i + '-' + Date.now().toString(36); const { svg } = await mermaid.render(id, code); div.innerHTML = svg; } catch (err) { console.error('Mermaid render error:', err); } } }; if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', renderMermaid); } else { renderMermaid(); } window.addEventListener('theme-changed', renderMermaid);`,
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
          items: [
            {
              label: 'Quick start',
              slug: 'quickstart',
            },
          ],
        },
        {
          label: 'Concepts',
          items: [
            {
              label: 'Overview: How A2UI Works',
              slug: 'concepts/overview',
              badge: {text: 'P0', variant: 'danger'},
            },
            {
              label: 'Messages',
              slug: 'concepts/messages',
              badge: {text: 'P0', variant: 'danger'},
            },
            {
              label: 'Catalogs, Components and Functions',
              slug: 'concepts/catalogs',
              badge: {text: 'P0', variant: 'danger'},
            },
            {
              label: 'Data Model and Data Binding',
              slug: 'concepts/data-binding',
              badge: {text: 'P0', variant: 'danger'},
            },
            {
              label: 'Actions and Functions',
              slug: 'concepts/actions-and-functions',
              badge: {text: 'P0', variant: 'danger'},
            },
            {
              label: 'Agent SDKs',
              slug: 'concepts/agent-sdks',
            },
            {
              label: 'Renderer SDKs',
              slug: 'concepts/renderer-sdks',
            },
            {
              label: 'Swappable Inference Formats',
              slug: 'concepts/inference-formats',
            },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'How to Integrate with My Client',
              slug: 'guides/client-integration',
            },
            {
              label: 'How to Integrate with My Agent Server',
              slug: 'guides/agent-integration',
            },
            {
              label: 'How to Define a Catalog',
              slug: 'guides/defining-a-catalog',
            },
            {
              label: 'A2UI over MCP',
              slug: 'guides/a2ui-over-mcp',
            },
            {
              label: 'MCP Apps in A2UI Surfaces',
              slug: 'guides/mcp-apps-in-a2ui',
            },
            {
              label: 'A2UI Dynamic Rendering within MCP Applications',
              slug: 'guides/a2ui-in-mcp-apps',
            },
            {
              label: 'Authoring Universal Web Components',
              slug: 'guides/authoring-universal-components',
            },
            {
              label: 'Iframe Catalog',
              slug: 'guides/iframe-catalog',
            },
          ],
        },
        {
          label: 'Roadmap',
          items: [
            {
              label: 'Roadmap',
              slug: 'roadmap',
            },
          ],
        },
        {
          label: 'Ecosystem',
          items: [
            {
              label: 'Ecosystem Renderers & Tools',
              slug: 'ecosystem/renderers',
            },
          ],
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
