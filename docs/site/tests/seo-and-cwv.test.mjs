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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  buildPreviewRedirectStubHtml,
  extractMetaRefreshTarget,
  isMetaRefreshHtml,
  runPostbuildSeo,
  sanitizeRedirectStubHtml,
} from '../scripts/postbuild-seo.mjs';
import {
  buildRobotsTxt,
  DEFAULT_OG_IMAGE_PATH,
  GOOGLE_FONTS_URL,
  stripHashFromUrl,
} from '../src/lib/seo.mjs';
import {normalizeBasePrefix} from '../src/lib/spec-schemas.mjs';
import {rehypeLocalDocAssets} from '../src/plugins/rehype-local-doc-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');

function walkFiles(dir, suffix, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, suffix, out);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

test('buildRobotsTxt emits root allow/disallow/sitemap directives and blocks subpath builds', () => {
  assert.equal(
    buildRobotsTxt(),
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /pr-preview/',
      '',
      'Sitemap: https://a2ui.org/sitemap-index.xml',
      '',
    ].join('\n'),
  );
  assert.equal(
    buildRobotsTxt({site: 'https://docs.example.com', base: '/'}),
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /pr-preview/',
      '',
      'Sitemap: https://docs.example.com/sitemap-index.xml',
      '',
    ].join('\n'),
  );
  assert.equal(buildRobotsTxt({base: '/preview/'}), 'User-agent: *\nDisallow: /\n');
  assert.equal(buildRobotsTxt({base: '/pr-preview/pr-999/'}), 'User-agent: *\nDisallow: /\n');
});

test('sanitizeRedirectStubHtml strips #fragments from canonicals on root builds and drops canonicals on ASTRO_BASE builds', () => {
  assert.equal(
    stripHashFromUrl('https://a2ui.org/concepts/sdks/#agent-sdk'),
    'https://a2ui.org/concepts/sdks/',
  );
  assert.equal(stripHashFromUrl('https://a2ui.org/quickstart/'), 'https://a2ui.org/quickstart/');

  const astroRedirect = [
    '<!doctype html>',
    '<title>Redirecting to: /concepts/sdks/#agent-sdk</title>',
    '<meta http-equiv="refresh" content="0;url=/concepts/sdks/#agent-sdk">',
    '<meta name="robots" content="noindex">',
    '<link rel="canonical" href="https://a2ui.org/concepts/sdks/#agent-sdk">',
    '<body><a href="/concepts/sdks/#agent-sdk">Redirecting</a></body>',
  ].join('');

  const rootSanitized = sanitizeRedirectStubHtml(astroRedirect);
  assert.match(
    rootSanitized,
    /<link rel="canonical" href="https:\/\/a2ui\.org\/concepts\/sdks\/">/,
  );
  assert.match(rootSanitized, /content="0;url=\/concepts\/sdks\/#agent-sdk"/);
  assert.match(rootSanitized, /<a href="\/concepts\/sdks\/#agent-sdk">/);

  // Also handles href appearing before rel="canonical"
  const reversedLinkOrder =
    '<meta http-equiv="refresh" content="0;url=/get-help/#consultants"><link href=\'https://a2ui.org/get-help/#consultants\' rel=\'canonical\'>';
  assert.match(
    sanitizeRedirectStubHtml(reversedLinkOrder),
    /<link href='https:\/\/a2ui\.org\/get-help\/' rel='canonical'>/,
  );

  // Subpath preview builds drop <link rel="canonical"> completely on redirect stubs
  const previewSanitized = sanitizeRedirectStubHtml(astroRedirect, {
    basePrefix: '/pr-preview/pr-999/',
  });
  assert.doesNotMatch(previewSanitized, /rel\s*=\s*["']?canonical/i);
  assert.match(previewSanitized, /content="0;url=\/concepts\/sdks\/#agent-sdk"/);

  // Non-redirect pages are left untouched
  const normalPage =
    '<!doctype html><html><head><link rel="canonical" href="https://a2ui.org/quickstart/"></head><body>Hi</body></html>';
  assert.equal(sanitizeRedirectStubHtml(normalPage), normalPage);
});

test('runPostbuildSeo copies sitemap.xml, sanitizes redirect canonicals, and emits 1-hop /preview/<slug>/ stubs', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postbuild-seo-test-'));
  t.after(() => fs.rmSync(tempDir, {recursive: true, force: true}));

  fs.mkdirSync(path.join(tempDir, 'quickstart'), {recursive: true});
  fs.mkdirSync(path.join(tempDir, 'built-with-a2ui'), {recursive: true});
  fs.mkdirSync(path.join(tempDir, 'showcase'), {recursive: true});
  fs.mkdirSync(path.join(tempDir, 'consultants'), {recursive: true});
  fs.mkdirSync(path.join(tempDir, 'preview'), {recursive: true});

  const sitemapXml =
    '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>';
  fs.writeFileSync(path.join(tempDir, 'sitemap-index.xml'), sitemapXml, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html></html>', 'utf8');
  fs.writeFileSync(path.join(tempDir, '404.html'), '<!doctype html><html></html>', 'utf8');
  fs.writeFileSync(
    path.join(tempDir, 'quickstart/index.html'),
    '<!doctype html><html><head><title>Quickstart</title></head><body></body></html>',
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempDir, 'built-with-a2ui/index.html'),
    '<!doctype html><html><head><title>Built with A2UI</title></head><body></body></html>',
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempDir, 'showcase/index.html'),
    '<!doctype html><meta http-equiv="refresh" content="0;url=/built-with-a2ui/"><meta name="robots" content="noindex"><link rel="canonical" href="https://a2ui.org/built-with-a2ui/">',
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempDir, 'consultants/index.html'),
    '<!doctype html><meta http-equiv="refresh" content="0;url=/get-help/#consultants"><meta name="robots" content="noindex"><link rel="canonical" href="https://a2ui.org/get-help/#consultants">',
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempDir, 'preview/index.html'),
    '<!doctype html><meta http-equiv="refresh" content="0;url=/"><meta name="robots" content="noindex"><link rel="canonical" href="https://a2ui.org/">',
    'utf8',
  );

  const summary = runPostbuildSeo({distDir: tempDir, base: '', siteOrigin: 'https://a2ui.org'});
  assert.equal(summary.copiedSitemapAlias, true);
  assert.equal(summary.sanitizedRedirects, 1);
  assert.equal(summary.previewRedirectsCreated, 4);

  assert.equal(fs.readFileSync(path.join(tempDir, 'sitemap.xml'), 'utf8'), sitemapXml);
  assert.match(
    fs.readFileSync(path.join(tempDir, 'consultants/index.html'), 'utf8'),
    /<link rel="canonical" href="https:\/\/a2ui\.org\/get-help\/">/,
  );

  // /preview/quickstart/ -> 1-hop to /quickstart/
  const previewQuickstart = fs.readFileSync(
    path.join(tempDir, 'preview/quickstart/index.html'),
    'utf8',
  );
  assert.equal(extractMetaRefreshTarget(previewQuickstart), '/quickstart/');
  assert.match(previewQuickstart, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(
    previewQuickstart,
    /<link rel="canonical" href="https:\/\/a2ui\.org\/quickstart\/">/,
  );

  // /preview/showcase/ -> flattened 1-hop directly to /built-with-a2ui/ (not /showcase/)
  const previewShowcase = fs.readFileSync(
    path.join(tempDir, 'preview/showcase/index.html'),
    'utf8',
  );
  assert.equal(extractMetaRefreshTarget(previewShowcase), '/built-with-a2ui/');
  assert.match(
    previewShowcase,
    /<link rel="canonical" href="https:\/\/a2ui\.org\/built-with-a2ui\/">/,
  );

  // /preview/consultants/ -> keeps #consultants in refresh target, strips #consultants in canonical
  const previewConsultants = fs.readFileSync(
    path.join(tempDir, 'preview/consultants/index.html'),
    'utf8',
  );
  assert.equal(extractMetaRefreshTarget(previewConsultants), '/get-help/#consultants');
  assert.match(previewConsultants, /<link rel="canonical" href="https:\/\/a2ui\.org\/get-help\/">/);

  // Subpath build skips sitemap.xml and /preview/<slug>/ generation
  const subDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postbuild-seo-sub-'));
  t.after(() => fs.rmSync(subDir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(subDir, 'quickstart'), {recursive: true});
  fs.writeFileSync(path.join(subDir, 'quickstart/index.html'), '<!doctype html><html></html>');
  const subSummary = runPostbuildSeo({distDir: subDir, base: '/pr-preview/pr-999/'});
  assert.equal(subSummary.copiedSitemapAlias, false);
  assert.equal(subSummary.previewRedirectsCreated, 0);
  assert.equal(fs.existsSync(path.join(subDir, 'sitemap.xml')), false);
  assert.equal(fs.existsSync(path.join(subDir, 'preview')), false);
});

test('rehypeLocalDocAssets preserves explicit loading and decoding overrides', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'img',
        properties: {src: '/local.webp', loading: 'eager', decoding: 'sync'},
        children: [],
      },
      {
        type: 'mdxJsxFlowElement',
        name: 'img',
        attributes: [
          {type: 'mdxJsxAttribute', name: 'src', value: '/local.webp'},
          {type: 'mdxJsxAttribute', name: 'loading', value: 'eager'},
        ],
        children: [],
      },
    ],
  };
  rehypeLocalDocAssets({manifest: {assets: {}}})(tree);
  assert.equal(tree.children[0].properties.loading, 'eager');
  assert.equal(tree.children[0].properties.decoding, 'sync');
  assert.equal(tree.children[1].attributes.find(a => a.name === 'loading').value, 'eager');
  assert.equal(tree.children[1].attributes.find(a => a.name === 'decoding').value, 'async');
});

test('source files enforce CWV font, search CSS, Mermaid, and Cloud Shell badge invariants', () => {
  assert.doesNotMatch(GOOGLE_FONTS_URL, /Playfair/i);
  assert.equal(DEFAULT_OG_IMAGE_PATH, '/assets/a2ui_gallery_examples.png');

  const tokensCss = fs.readFileSync(path.join(siteRoot, 'src/styles/tokens.css'), 'utf8');
  assert.match(tokensCss, /font-family:\s*['"]Manrope Fallback['"]/);
  assert.match(tokensCss, /font-weight:\s*100 699/);
  assert.match(tokensCss, /font-weight:\s*700 900/);
  assert.doesNotMatch(tokensCss, /Playfair Display/i);

  const headerAstro = fs.readFileSync(
    path.join(siteRoot, 'src/components/StarlightHeader.astro'),
    'utf8',
  );
  const frontmatter = headerAstro.split('---')[1] || '';
  assert.doesNotMatch(frontmatter, /@pagefind\/default-ui\/css\/ui\.css/);
  assert.match(headerAstro, /import\(['"]@pagefind\/default-ui\/css\/ui\.css['"]\)/);
  assert.match(headerAstro, /new IntersectionObserver/);
  assert.match(headerAstro, /rootMargin:\s*['"]300px 0px['"]/);

  const stepByStepMdx = fs.readFileSync(
    path.join(siteRoot, 'src/content/docs/quickstart/step-by-step.mdx'),
    'utf8',
  );
  assert.doesNotMatch(stepByStepMdx, /https:\/\/gstatic\.com\/cloudssh/);
  assert.match(stepByStepMdx, /https:\/\/www\.gstatic\.com\/cloudssh\/images\/open-btn\.svg/);
  assert.match(stepByStepMdx, /width="270"/);
  assert.match(stepByStepMdx, /height="54"/);
});

test('built dist/ satisfies Search Console, robots.txt, sitemap, canonical, 404, redirect, and CWV invariants', t => {
  const distDir = path.join(siteRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    t.skip('dist/ has not been built yet');
    return;
  }

  const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const configuredBase = normalizeBasePrefix(process.env.ASTRO_BASE);
  const detectedBaseMatch = indexHtml.match(/href="(\/[^"]*?)\/assets\/favicon\.svg"/);
  const effectiveBase = configuredBase || (detectedBaseMatch ? detectedBaseMatch[1] : '');
  const isSubpathBuild = Boolean(effectiveBase);

  const robotsPath = path.join(distDir, 'robots.txt');
  assert.ok(fs.existsSync(robotsPath), 'Expected dist/robots.txt to exist');
  const robotsTxt = fs.readFileSync(robotsPath, 'utf8');

  if (isSubpathBuild) {
    assert.equal(robotsTxt, 'User-agent: *\nDisallow: /\n');
    assert.equal(
      fs.existsSync(path.join(distDir, 'sitemap-index.xml')),
      false,
      'ASTRO_BASE build must not emit sitemap-index.xml',
    );
    assert.equal(
      fs.existsSync(path.join(distDir, 'sitemap.xml')),
      false,
      'ASTRO_BASE build must not emit sitemap.xml',
    );
    assert.equal(
      fs.existsSync(path.join(distDir, 'sitemap-0.xml')),
      false,
      'ASTRO_BASE build must not emit sitemap-0.xml',
    );

    const htmlFiles = walkFiles(distDir, '.html');
    assert.ok(htmlFiles.length > 0);
    for (const htmlFile of htmlFiles) {
      const rel = path.relative(distDir, htmlFile);
      const html = fs.readFileSync(htmlFile, 'utf8');
      assert.match(
        html,
        /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["']noindex/i,
        `${rel} in ASTRO_BASE build must include noindex`,
      );
      assert.doesNotMatch(
        html,
        /<link\b[^>]*\brel=["']canonical["']/i,
        `${rel} in ASTRO_BASE build must omit <link rel="canonical">`,
      );
      assert.doesNotMatch(
        html,
        /<link\b[^>]*\brel=["']sitemap["']/i,
        `${rel} in ASTRO_BASE build must omit <link rel="sitemap">`,
      );
      assert.doesNotMatch(
        html,
        /<meta\b[^>]*\bproperty=["']og:url["']/i,
        `${rel} in ASTRO_BASE build must omit og:url`,
      );
    }
    return;
  }

  // Root production build assertions
  assert.match(
    robotsTxt,
    /^User-agent: \*\nAllow: \/\nDisallow: \/pr-preview\/\n\nSitemap: https:\/\/a2ui\.org\/sitemap-index\.xml\n$/,
  );

  const sitemapIndexPath = path.join(distDir, 'sitemap-index.xml');
  const sitemapAliasPath = path.join(distDir, 'sitemap.xml');
  const sitemapZeroPath = path.join(distDir, 'sitemap-0.xml');
  assert.ok(fs.existsSync(sitemapIndexPath), 'Expected dist/sitemap-index.xml');
  assert.ok(fs.existsSync(sitemapAliasPath), 'Expected dist/sitemap.xml copy');
  assert.ok(fs.existsSync(sitemapZeroPath), 'Expected dist/sitemap-0.xml');
  assert.equal(
    fs.readFileSync(sitemapAliasPath, 'utf8'),
    fs.readFileSync(sitemapIndexPath, 'utf8'),
  );

  const sitemapZero = fs.readFileSync(sitemapZeroPath, 'utf8');
  for (const expectedLoc of [
    'https://a2ui.org/',
    'https://a2ui.org/built-with-a2ui/',
    'https://a2ui.org/get-help/',
    'https://a2ui.org/quickstart/',
  ]) {
    assert.ok(
      sitemapZero.includes(`<loc>${expectedLoc}</loc>`),
      `Missing ${expectedLoc} in sitemap-0.xml`,
    );
  }
  assert.doesNotMatch(sitemapZero, /<loc>https:\/\/a2ui\.org\/404\/?<\/loc>/);
  assert.doesNotMatch(sitemapZero, /<loc>https:\/\/a2ui\.org\/preview\//);
  assert.doesNotMatch(sitemapZero, /<loc>https:\/\/a2ui\.org\/showcase\//);

  // Marketing pages head, doctype, canonicals, social tags, non-blocking fonts, and JSON-LD
  const marketingPages = [
    {file: 'index.html', canonical: 'https://a2ui.org/', hasJsonLd: true},
    {
      file: 'built-with-a2ui/index.html',
      canonical: 'https://a2ui.org/built-with-a2ui/',
      hasJsonLd: false,
    },
    {file: 'get-help/index.html', canonical: 'https://a2ui.org/get-help/', hasJsonLd: false},
  ];

  for (const page of marketingPages) {
    const html = fs.readFileSync(path.join(distDir, page.file), 'utf8');
    assert.match(html, /^<!doctype html>/i, `${page.file} must start with <!doctype html>`);
    assert.match(html, /<html\b[^>]*\blang="en"/i);
    assert.ok(
      html.includes(`<link rel="canonical" href="${page.canonical}"`),
      `${page.file} missing canonical ${page.canonical}`,
    );
    assert.ok(html.includes('<link rel="sitemap" href="/sitemap-index.xml"'));
    assert.ok(html.includes(`<meta property="og:url" content="${page.canonical}"`));
    assert.match(html, /<meta property="og:title" content="[^"]+"/);
    assert.match(html, /<meta property="og:description" content="[^"]+"/);
    assert.match(html, /<meta property="og:type" content="website"/);
    assert.match(html, /<meta property="og:site_name" content="A2UI"/);
    assert.ok(
      html.includes(
        '<meta property="og:image" content="https://a2ui.org/assets/a2ui_gallery_examples.png"',
      ),
    );
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
    assert.ok(
      html.includes(
        '<meta name="twitter:image" content="https://a2ui.org/assets/a2ui_gallery_examples.png"',
      ),
    );
    assert.ok(html.includes('href="/llms.txt"'));
    assert.doesNotMatch(html, /Playfair\+Display/i);
    assert.match(html, /media="print" onload="this\.media=&#39;all&#39;|this\.media='all'"/);
    if (page.hasJsonLd) {
      assert.match(html, /<script type="application\/ld\+json">.*?"@type":"WebSite".*?<\/script>/);
    }
  }

  // 404.html must be noindex and omit canonical, og:url, and sitemap
  const notFoundHtml = fs.readFileSync(path.join(distDir, '404.html'), 'utf8');
  assert.match(notFoundHtml, /<meta name="robots" content="noindex, nofollow"/i);
  assert.doesNotMatch(notFoundHtml, /<link\b[^>]*\brel="canonical"/i);
  assert.doesNotMatch(notFoundHtml, /<meta\b[^>]*\bproperty="og:url"/i);
  assert.doesNotMatch(notFoundHtml, /<link\b[^>]*\brel="sitemap"/i);
  assert.doesNotMatch(notFoundHtml, /Playfair\+Display/i);

  // Starlight docs page has canonical, og:image, non-blocking fonts, and zero Playfair Display
  const quickstartHtml = fs.readFileSync(path.join(distDir, 'quickstart/index.html'), 'utf8');
  assert.ok(quickstartHtml.includes('<link rel="canonical" href="https://a2ui.org/quickstart/"'));
  assert.ok(
    quickstartHtml.includes(
      '<meta property="og:image" content="https://a2ui.org/assets/a2ui_gallery_examples.png"',
    ),
  );
  assert.doesNotMatch(quickstartHtml, /Playfair\+Display/i);

  // Every redirect stub in dist/ has noindex and a fragmentless canonical
  const allHtmlFiles = walkFiles(distDir, '.html');
  let redirectCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    if (!isMetaRefreshHtml(html)) continue;
    redirectCount++;
    const rel = path.relative(distDir, htmlFile);
    assert.match(
      html,
      /<meta\b[^>]*\bname="robots"[^>]*\bcontent="noindex/i,
      `${rel} missing noindex`,
    );
    const canonicalMatch = html.match(/<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i);
    assert.ok(canonicalMatch, `${rel} missing canonical`);
    assert.equal(
      canonicalMatch[1].includes('#'),
      false,
      `${rel} canonical must not contain #fragment: ${canonicalMatch[1]}`,
    );
  }
  assert.ok(
    redirectCount > 50,
    `Expected >50 redirect stubs including /preview/*, got ${redirectCount}`,
  );

  // Key legacy /preview/* and /a2a-extension/* redirects exist and resolve cleanly
  for (const [stubRel, expectedTarget] of [
    ['preview/quickstart/index.html', '/quickstart/'],
    ['preview/showcase/index.html', '/built-with-a2ui/'],
    ['preview/concepts/macros/index.html', '/guides/macros/'],
    ['a2a-extension/a2ui/v1.0/index.html', '/specification/v1.0-a2ui-extension-specification/'],
    ['a2a-extension/a2ui/v0.9.1/index.html', '/specification/v0.9.1-a2ui-extension-specification/'],
  ]) {
    const fullStub = path.join(distDir, stubRel);
    assert.ok(fs.existsSync(fullStub), `Missing expected redirect stub ${stubRel}`);
    const stubHtml = fs.readFileSync(fullStub, 'utf8');
    assert.equal(extractMetaRefreshTarget(stubHtml), expectedTarget);
  }

  // get-help.astro CWV checks: 16 sized consultant logos, preload="none" videos, preloaded first poster, trailing slash
  const getHelpHtml = fs.readFileSync(path.join(distDir, 'get-help/index.html'), 'utf8');
  const logoTags =
    getHelpHtml.match(/<img\b[^>]*\bclass="[^"]*\bc-agency-logo\b[^"]*"[^>]*>/g) || [];
  assert.equal(logoTags.length, 16, 'Expected 16 consultant logo <img> tags');
  for (const tag of logoTags) {
    assert.match(tag, /\bwidth="\d+"/, `Consultant logo missing width: ${tag}`);
    assert.match(tag, /\bheight="\d+"/, `Consultant logo missing height: ${tag}`);
  }
  assert.doesNotMatch(getHelpHtml, /<video\b[^>]*\bpreload="metadata"/);
  assert.match(getHelpHtml, /<video\b[^>]*\bpreload="none"/);
  assert.match(getHelpHtml, /<link\b[^>]*\brel="preload"[^>]*\bas="image"/);
  assert.doesNotMatch(getHelpHtml, /href="https:\/\/a2ui\.org"/);
});
