// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { remarkA2uiIncludes } from './src/plugins/remark-a2ui-includes.mjs';

export default defineConfig({
  site: 'https://a2ui.org',
  markdown: {
    remarkPlugins: [remarkA2uiIncludes],
  },
  integrations: [
    starlight({
      title: 'A2UI',
      description: 'The open Agent-to-UI protocol and SDK suite for native, stateful generative user interfaces.',
      logo: {
        light: './src/assets/A2UI_dark.svg',
        dark: './src/assets/A2UI_light.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/a2ui-project/a2ui',
        discord: 'https://discord.gg/6fS2326966',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: '5-Minute Quickstart (Pilot)', slug: 'quickstart' },
          ],
        },
        {
          label: 'Specifications',
          items: [
            {
              label: 'v1.0 Protocol Spec (Pilot)',
              slug: 'specification/v1.0-a2ui',
              badge: { text: 'Candidate', variant: 'tip' },
            },
          ],
        },
      ],
    }),
  ],
});
