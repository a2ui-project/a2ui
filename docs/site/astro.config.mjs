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
import starlight from '@astrojs/starlight';
import {defineConfig} from 'astro/config';

import {remarkA2uiIncludes} from './src/plugins/remark-a2ui-includes.mjs';
import {rehypeWrapTables} from './src/plugins/rehype-wrap-tables.mjs';

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

export default defineConfig({
  site: process.env.ASTRO_SITE || 'https://a2ui.org',
  base: process.env.ASTRO_BASE || undefined,
  redirects: {
    '/specification/v0.9-a2ui': '/specification/v0.9.1-a2ui/',
    '/specification/v0.9-evolution-guide': '/specification/v0.9.1-evolution-guide/',
    '/concepts/actions': '/concepts/actions-and-functions/',
    '/concepts/agent-sdks': '/concepts/sdks/#agent-sdk',
    '/concepts/components': '/concepts/catalogs/',
    '/concepts/data-flow': '/concepts/data-binding/',
    '/concepts/renderer-sdks': '/concepts/sdks/#renderer-sdk',
    '/concepts/transports': '/concepts/messages/',
    '/guides/a2ui_over_mcp': '/guides/a2ui-over-mcp/',
    '/guides/defining-your-own-catalog': '/guides/defining-a-catalog/',
    '/guides/client-setup': '/guides/client-integration/',
    '/guides/agent-development': '/guides/agent-integration/',
    '/specification/v0.8-a2ui': '/specification/v1.0-a2ui/',
    '/specification/v0.8-a2a-extension': '/specification/v1.0-a2ui-extension-specification/',
    '/specification/v0.8-custom-catalog-changes': '/specification/v1.0-a2ui/',
    '/specification/v0.8/schemas': '/specification/v1.0/schemas/',
  },
  markdown: {
    remarkPlugins: [remarkA2uiIncludes],
    rehypePlugins: [rehypeWrapTables, rehypePreserveJsonHeadingIds],
  },
  integrations: [
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
            href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,400..700;1,400..700&display=swap',
          },
        },
        {
          tag: 'script',
          attrs: {
            type: 'module',
          },
          content: `const renderMermaid = async () => { for (const pre of document.querySelectorAll('pre[data-language="mermaid"]')) { const lines = pre.querySelectorAll('.ec-line'); const code = (lines.length ? Array.from(lines, l => l.textContent).join('\\n') : (pre.querySelector('code')?.textContent || pre.textContent)).trim(); const div = document.createElement('div'); div.className = 'mermaid-rendered not-content'; div.dataset.mermaidSource = code; (pre.closest('.expressive-code') || pre).replaceWith(div); } const blocks = document.querySelectorAll('.mermaid-rendered[data-mermaid-source]'); if (!blocks.length) return; const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'); const isDark = document.documentElement.getAttribute('data-theme') !== 'light'; mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', fontFamily: 'inherit' }); for (let i = 0; i < blocks.length; i++) { const div = blocks[i]; const code = div.dataset.mermaidSource; if (!code) continue; try { const id = 'mermaid-svg-' + i + '-' + Date.now().toString(36); const { svg } = await mermaid.render(id, code); div.innerHTML = svg; } catch (err) { console.error('Mermaid render error:', err); } } }; if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', renderMermaid); } else { renderMermaid(); } new MutationObserver(() => renderMermaid()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });`,
        },
      ],
      components: {
        Header: './src/components/StarlightHeader.astro',
      },
      customCss: ['./src/styles/tokens.css', './src/styles/custom.css'],
      sidebar: [
        {
          label: 'Navigation',
          items: [
            {
              label: '← Back to Overview',
              link: '/',
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
              label: 'Catalogs',
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
              label: 'SDKs',
              slug: 'concepts/sdks',
            },
            {
              label: 'Swappable Inference Formats',
              slug: 'concepts/inference-formats',
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
              label: 'Model Context Protocol (MCP)',
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
