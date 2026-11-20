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

// Tests for scripts/docs_site_preview.mjs. Run with `node --test scripts/`.

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import reconcileDocsSitePreviews, {
  collectChangedPreviewLinks,
  commitAndPushGhPages,
  formatActivePreviewComment,
  formatRemovedPreviewComment,
  injectNoindexMeta,
  PREVIEW_COMMENT_MARKER,
  resolveWorkflowRunPr,
  runCli,
  sanitizePreviewHtml,
  stagePreviewBundle,
  syncGhPagesPreviewTree,
  validateSiteDirectory,
} from './docs_site_preview.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function writeFile(rootDir, relPath, content) {
  const fullPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), {recursive: true});
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

describe('docs_site_preview', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-docs-preview-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  describe('injectNoindexMeta & sanitizePreviewHtml', () => {
    it('inserts noindex meta tag before </head>', () => {
      const html = '<!doctype html><html><head><title>A2UI</title></head><body>Hi</body></html>';
      const out = injectNoindexMeta(html);
      assert.match(out, /<meta name="robots" content="noindex, nofollow">\n<\/head>/);
    });

    it('replaces any existing robots meta tag (quoted, unquoted, reversed, or index, follow) without duplicating', () => {
      for (const rawMeta of [
        '<meta name="robots" content="noindex">',
        '<meta name="robots" content="index, follow">',
        '<meta content="all" name=\'ROBOTS\'/>',
        '<meta name=robots content=index>',
        '<meta name="robots" content="index"><meta name="robots" content="follow">',
      ]) {
        const html = `<html><head>${rawMeta}<title>A2UI</title></head></html>`;
        const out = injectNoindexMeta(html);
        const matches = out.match(/<meta\b[^>]*\bname\s*=\s*["']?robots["']?[^>]*>/gi) || [];
        assert.deepEqual(matches, ['<meta name="robots" content="noindex, nofollow">']);
      }
    });

    it('injects noindex, nofollow into headless Astro redirect HTML stubs', () => {
      const redirectStub =
        '<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/pr-preview/pr-42/quickstart/"><meta name="robots" content="noindex"><body><a href="/pr-preview/pr-42/quickstart/">Redirect</a></body>';
      const out = injectNoindexMeta(redirectStub);
      const matches = out.match(/<meta\b[^>]*\bname\s*=\s*["']?robots["']?[^>]*>/gi) || [];
      assert.deepEqual(matches, ['<meta name="robots" content="noindex, nofollow">']);
      assert.ok(out.indexOf('noindex, nofollow') < out.indexOf('<body>'));
    });

    it('strips canonical and sitemap <link> tags while preserving stylesheets, icons, scripts, templates, and comments', () => {
      const html = [
        '<!doctype html><html><head>',
        '  <link rel="canonical" href="https://a2ui.org/pr-preview/pr-42/quickstart/">',
        '  <link href="https://a2ui.org/pr-preview/pr-42/other/" rel="canonical"/>',
        '  <link rel=sitemap href=/pr-preview/pr-42/sitemap-index.xml>',
        '  <link rel="stylesheet" href="/pr-preview/pr-42/_astro/main.css">',
        '  <link rel="icon" href="/pr-preview/pr-42/assets/favicon.svg">',
        '  <link rel="alternate" type="text/markdown" href="/pr-preview/pr-42/llms.txt">',
        '  <meta name="robots" content="index, follow">',
        '  <!-- <link rel="canonical" href="https://keep-comment.example/"> -->',
        '  <template><link rel="canonical" href="https://keep-template.example/"></template>',
        '  <script>const snippet = \'<link rel="canonical" href="https://keep-script.example/"><meta name="robots" content="index">\';</script>',
        '</head><body></body></html>',
      ].join('\n');

      const out = sanitizePreviewHtml(html);
      assert.doesNotMatch(out, /pr-preview\/pr-42\/quickstart/);
      assert.doesNotMatch(out, /pr-preview\/pr-42\/other/);
      assert.doesNotMatch(out, /sitemap-index\.xml/);
      assert.doesNotMatch(out, /index,\s*follow/);
      assert.match(out, /<meta name="robots" content="noindex, nofollow">/);
      assert.match(out, /rel="stylesheet"/);
      assert.match(out, /rel="icon"/);
      assert.match(out, /rel="alternate"/);
      assert.match(out, /keep-comment\.example/);
      assert.match(out, /keep-template\.example/);
      assert.match(out, /keep-script\.example/);
    });
  });

  describe('stagePreviewBundle & validateSiteDirectory', () => {
    it('stages dist/, strips CNAME/.nojekyll/robots.txt/sitemaps, strips canonical & sitemap links, enforces noindex, and writes pr-metadata.json', () => {
      const distDir = path.join(tmpDir, 'dist');
      const outDir = path.join(tmpDir, 'bundle');

      writeFile(
        distDir,
        'index.html',
        '<html><head><title>Home</title><link rel="canonical" href="https://a2ui.org/pr-preview/pr-4055/"><link rel="sitemap" href="/pr-preview/pr-4055/sitemap-index.xml"></head><body></body></html>',
      );
      writeFile(
        distDir,
        'quickstart/index.html',
        '<html><head><meta name="robots" content="index, follow"><link href="https://a2ui.org/pr-preview/pr-4055/quickstart/" rel="canonical"/><title>Quickstart</title></head><body></body></html>',
      );
      writeFile(
        distDir,
        'actions/index.html',
        '<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/pr-preview/pr-4055/concepts/actions-and-functions/"><meta name="robots" content="noindex"><link rel="canonical" href="https://a2ui.org/pr-preview/pr-4055/concepts/actions-and-functions/"><body></body>',
      );
      writeFile(distDir, 'CNAME', 'a2ui.org\n');
      writeFile(distDir, '.nojekyll', '');
      writeFile(distDir, 'robots.txt', 'User-agent: *\nAllow: /\n');
      writeFile(distDir, 'sitemap.xml', '<urlset/>');
      writeFile(distDir, 'sitemap.xml.gz', 'gz');
      writeFile(distDir, 'sitemap-index.xml', '<sitemapindex/>');
      writeFile(distDir, 'sitemap-0.xml', '<urlset/>');
      writeFile(distDir, 'nested/sitemap-extra.xml', '<urlset/>');

      const metadata = stagePreviewBundle({
        distDir,
        outDir,
        prNumber: '4055',
        headSha: SHA_A.toUpperCase(),
      });

      assert.deepEqual(metadata, {pr_number: 4055, head_sha: SHA_A});
      for (const removedRel of [
        'CNAME',
        '.nojekyll',
        'robots.txt',
        'sitemap.xml',
        'sitemap.xml.gz',
        'sitemap-index.xml',
        'sitemap-0.xml',
        'nested/sitemap-extra.xml',
      ]) {
        assert.equal(
          fs.existsSync(path.join(outDir, 'site', removedRel)),
          false,
          `Expected ${removedRel} to be stripped from staged preview`,
        );
      }

      for (const htmlRel of ['index.html', 'quickstart/index.html', 'actions/index.html']) {
        const stagedHtml = fs.readFileSync(path.join(outDir, 'site', htmlRel), 'utf8');
        assert.match(stagedHtml, /<meta name="robots" content="noindex, nofollow">/);
        assert.doesNotMatch(stagedHtml, /rel=["']?canonical["']?/i);
        assert.doesNotMatch(stagedHtml, /rel=["']?sitemap["']?/i);
        assert.doesNotMatch(stagedHtml, /index,\s*follow/i);
      }
      const stagedMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'pr-metadata.json'), 'utf8'));
      assert.deepEqual(stagedMeta, {pr_number: 4055, head_sha: SHA_A});
    });

    it('rejects symbolic links and .git directories inside preview site', () => {
      const distDir = path.join(tmpDir, 'dist');
      writeFile(distDir, 'index.html', '<html><head></head></html>');
      fs.symlinkSync('/etc/passwd', path.join(distDir, 'escape.txt'));

      assert.throws(() => validateSiteDirectory(distDir), /Symbolic links are forbidden/);

      fs.unlinkSync(path.join(distDir, 'escape.txt'));
      fs.mkdirSync(path.join(distDir, '.git'));
      assert.throws(() => validateSiteDirectory(distDir), /Forbidden \.git entry/);
    });

    it('rejects bundles exceeding maxBytes', () => {
      const distDir = path.join(tmpDir, 'dist');
      writeFile(distDir, 'index.html', '<html><head></head><body>1234567890</body></html>');

      assert.throws(() => validateSiteDirectory(distDir, {maxBytes: 10}), /exceeds size limit/);
    });

    it('rejects empty or unsafe outDir paths (cwd, root, or distDir)', () => {
      const distDir = path.join(tmpDir, 'dist');
      writeFile(distDir, 'index.html', '<html><head></head></html>');

      assert.throws(
        () => stagePreviewBundle({distDir, outDir: '', prNumber: 1, headSha: SHA_A}),
        /outDir must be a non-empty path string/,
      );
      assert.throws(
        () => stagePreviewBundle({distDir, outDir: process.cwd(), prNumber: 1, headSha: SHA_A}),
        /Refusing to stage preview bundle into unsafe directory/,
      );
      assert.throws(
        () => stagePreviewBundle({distDir, outDir: '/', prNumber: 1, headSha: SHA_A}),
        /Refusing to stage preview bundle into unsafe directory/,
      );
      assert.throws(
        () => stagePreviewBundle({distDir, outDir: distDir, prNumber: 1, headSha: SHA_A}),
        /Refusing to stage preview bundle into unsafe directory/,
      );
      assert.throws(
        () => stagePreviewBundle({distDir, outDir: tmpDir, prNumber: 1, headSha: SHA_A}),
        /Refusing to stage preview bundle into unsafe directory/,
      );
      assert.equal(fs.existsSync(path.join(distDir, 'index.html')), true);
    });

    it('validates required CLI flags in runCli before resolving paths', () => {
      const distDir = path.join(tmpDir, 'dist');
      const outDir = path.join(tmpDir, 'bundle');
      writeFile(distDir, 'index.html', '<html><head></head></html>');

      assert.throws(
        () => runCli(['stage', '--dist', distDir, '--pr', '42', '--sha', SHA_A]),
        /Missing required flags/,
      );
      assert.throws(
        () => runCli(['stage', '--dist', distDir, '--out', '--pr', '42', '--sha', SHA_A]),
        /Missing required flags/,
      );
      assert.throws(
        () => runCli(['stage', '--dist', distDir, '--out', '   ', '--pr', '42', '--sha', SHA_A]),
        /Missing required flags/,
      );

      const meta = runCli([
        'stage',
        '--dist',
        distDir,
        '--out',
        outDir,
        '--pr',
        '42',
        '--sha',
        SHA_A,
      ]);
      assert.deepEqual(meta, {pr_number: 42, head_sha: SHA_A});
    });
  });

  describe('resolveWorkflowRunPr', () => {
    const forkPr = {
      number: 4055,
      state: 'open',
      head: {
        ref: 'docs/my-change',
        sha: SHA_A,
        repo: {owner: {login: 'contributor-fork'}},
      },
    };

    it('resolves fork PRs even when workflow_run.pull_requests is empty', () => {
      const result = resolveWorkflowRunPr({
        workflowRun: {
          id: 99,
          head_sha: SHA_A,
          head_branch: 'docs/my-change',
          head_repository: {owner: {login: 'contributor-fork'}},
          pull_requests: [],
        },
        openPrs: [forkPr],
        repoFullName: 'a2ui-project/a2ui',
      });

      assert.equal(result.pr?.number, 4055);
      assert.equal(result.stale, false);
    });

    it('marks build as stale if PR head moved to a newer commit', () => {
      const updatedPr = {
        ...forkPr,
        head: {...forkPr.head, sha: SHA_B},
      };
      const result = resolveWorkflowRunPr({
        workflowRun: {
          id: 99,
          head_sha: SHA_A,
          head_branch: 'docs/my-change',
          head_repository: {owner: {login: 'contributor-fork'}},
          pull_requests: [],
        },
        openPrs: [updatedPr],
        repoFullName: 'a2ui-project/a2ui',
      });

      assert.equal(result.pr?.number, 4055);
      assert.equal(result.stale, true);
      assert.equal(result.reason, 'stale_sha');
    });

    it('returns null PR when the PR was already closed', () => {
      const result = resolveWorkflowRunPr({
        workflowRun: {
          id: 99,
          head_sha: SHA_A,
          head_branch: 'docs/my-change',
          head_repository: {owner: {login: 'contributor-fork'}},
          pull_requests: [],
        },
        openPrs: [],
        repoFullName: 'a2ui-project/a2ui',
      });

      assert.equal(result.pr, null);
      assert.equal(result.reason, 'closed_or_not_found');
    });
  });

  describe('collectChangedPreviewLinks', () => {
    it('maps modified docs, landing page, and specification files to built routes', () => {
      const siteDir = path.join(tmpDir, 'site');
      writeFile(siteDir, 'index.html', '<html></html>');
      writeFile(siteDir, 'concepts/messages/index.html', '<html></html>');
      writeFile(siteDir, 'specification/v1.0-a2ui/index.html', '<html></html>');
      writeFile(siteDir, 'specification/v1.0/schemas/index.html', '<html></html>');

      const links = collectChangedPreviewLinks({
        prNumber: 4055,
        previewSiteDir: siteDir,
        prFiles: [
          {filename: 'docs/site/src/pages/index.astro', status: 'modified'},
          {filename: 'docs/site/src/content/docs/concepts/messages.mdx', status: 'modified'},
          {filename: 'specification/v1_0/docs/a2ui_protocol.md', status: 'modified'},
          {filename: 'specification/v1_0/json/server_to_client.json', status: 'modified'},
          {filename: 'docs/site/src/content/docs/missing-page.md', status: 'added'},
          {filename: 'docs/site/src/content/docs/concepts/deleted.md', status: 'removed'},
        ],
      });

      assert.deepEqual(links, [
        {route: '/', url: 'https://a2ui.org/pr-preview/pr-4055/'},
        {
          route: '/concepts/messages/',
          url: 'https://a2ui.org/pr-preview/pr-4055/concepts/messages/',
        },
        {
          route: '/specification/v1.0-a2ui/',
          url: 'https://a2ui.org/pr-preview/pr-4055/specification/v1.0-a2ui/',
        },
        {
          route: '/specification/v1.0/schemas/',
          url: 'https://a2ui.org/pr-preview/pr-4055/specification/v1.0/schemas/',
        },
      ]);
    });
  });

  describe('syncGhPagesPreviewTree & commitAndPushGhPages', () => {
    it('deploys active PR preview, preserves root files and open PRs, and prunes closed PRs', () => {
      const ghPagesDir = path.join(tmpDir, 'gh-pages');
      const newSiteDir = path.join(tmpDir, 'new-site');

      writeFile(ghPagesDir, 'CNAME', 'a2ui.org\n');
      writeFile(ghPagesDir, 'index.html', '<html>Production Root</html>');
      writeFile(ghPagesDir, 'pr-preview/pr-100/index.html', '<html>Closed PR 100</html>');
      writeFile(ghPagesDir, 'pr-preview/pr-200/index.html', '<html>Open PR 200</html>');
      writeFile(newSiteDir, 'index.html', '<html><head></head><body>PR 300</body></html>');

      const result = syncGhPagesPreviewTree({
        ghPagesDir,
        openPrNumbers: [200, 300],
        deploy: {prNumber: 300, siteDir: newSiteDir},
      });

      assert.equal(result.deployedPrNumber, 300);
      assert.deepEqual(result.removedPrNumbers, [100]);
      assert.equal(fs.readFileSync(path.join(ghPagesDir, 'CNAME'), 'utf8'), 'a2ui.org\n');
      assert.equal(fs.existsSync(path.join(ghPagesDir, 'pr-preview/pr-100')), false);
      assert.equal(fs.existsSync(path.join(ghPagesDir, 'pr-preview/pr-200/index.html')), true);
      assert.equal(fs.existsSync(path.join(ghPagesDir, 'pr-preview/pr-300/index.html')), true);
    });

    it('retries push on transient non-fast-forward conflict', () => {
      const ghPagesDir = path.join(tmpDir, 'gh-pages');
      const newSiteDir = path.join(tmpDir, 'new-site');
      fs.mkdirSync(ghPagesDir, {recursive: true});
      writeFile(newSiteDir, 'index.html', '<html><head></head><body>PR 300</body></html>');

      const calls = [];
      let pushCalls = 0;

      const execGit = args => {
        calls.push(args);
        if (args[0] === 'status') return 'A  pr-preview/pr-300/index.html\n';
        if (args[0] === 'push') {
          pushCalls++;
          if (pushCalls === 1) {
            throw new Error('! [rejected] HEAD -> gh-pages (fetch first)');
          }
        }
        return '';
      };

      const res = commitAndPushGhPages({
        ghPagesDir,
        openPrNumbers: [300],
        deploy: {prNumber: 300, headSha: SHA_A, siteDir: newSiteDir},
        execGit,
      });

      assert.equal(res.pushed, true);
      assert.equal(pushCalls, 2);
      assert.equal(
        calls.some(args => args[0] === 'fetch' && args[2] === 'gh-pages'),
        true,
      );
    });

    it('commits and pushes cleanly against a real git remote across deploy and full cleanup', () => {
      const remoteDir = path.join(tmpDir, 'remote.git');
      const ghPagesDir = path.join(tmpDir, 'gh-pages-clone');
      const siteDir = path.join(tmpDir, 'preview-site');

      execFileSync('git', ['init', '--bare', remoteDir]);
      execFileSync('git', ['init', '-b', 'gh-pages', ghPagesDir]);
      execFileSync('git', ['-C', ghPagesDir, 'config', 'user.name', 'Test']);
      execFileSync('git', ['-C', ghPagesDir, 'config', 'user.email', 'test@example.com']);
      execFileSync('git', ['-C', ghPagesDir, 'remote', 'add', 'origin', remoteDir]);

      writeFile(ghPagesDir, 'CNAME', 'a2ui.org\n');
      writeFile(ghPagesDir, '.nojekyll', '');
      writeFile(ghPagesDir, 'index.html', '<html>Main Site</html>');
      execFileSync('git', ['-C', ghPagesDir, 'add', '.']);
      execFileSync('git', ['-C', ghPagesDir, 'commit', '-m', 'Initial gh-pages']);
      execFileSync('git', ['-C', ghPagesDir, 'push', '-u', 'origin', 'gh-pages']);

      // 1. No-op cleanup when no pr-preview directory exists yet
      const noopRes = commitAndPushGhPages({ghPagesDir, openPrNumbers: []});
      assert.equal(noopRes.pushed, false);

      // 2. Deploy PR #42
      writeFile(siteDir, 'index.html', '<html><head></head><body>PR 42</body></html>');
      const deployRes = commitAndPushGhPages({
        ghPagesDir,
        openPrNumbers: [42],
        deploy: {prNumber: 42, headSha: SHA_A, siteDir},
      });
      assert.equal(deployRes.pushed, true);
      assert.equal(deployRes.deployedPrNumber, 42);

      // 3. Re-running with identical content is a clean no-op
      const idempotentRes = commitAndPushGhPages({
        ghPagesDir,
        openPrNumbers: [42],
        deploy: {prNumber: 42, headSha: SHA_A, siteDir},
      });
      assert.equal(idempotentRes.pushed, false);

      // 4. Close PR #42 -> pr-preview/ removed from remote while CNAME and index.html remain
      const cleanupRes = commitAndPushGhPages({ghPagesDir, openPrNumbers: []});
      assert.equal(cleanupRes.pushed, true);
      assert.deepEqual(cleanupRes.removedPrNumbers, [42]);

      const remoteTree = execFileSync(
        'git',
        ['--git-dir', remoteDir, 'ls-tree', '-r', 'gh-pages'],
        {
          encoding: 'utf8',
        },
      );
      assert.match(remoteTree, /\bCNAME\b/);
      assert.match(remoteTree, /\bindex\.html\b/);
      assert.doesNotMatch(remoteTree, /pr-preview/);
    });
  });

  describe('reconcileDocsSitePreviews end-to-end orchestration', () => {
    it('deploys fork PR bundle, updates sticky comment, and marks closed PR comment removed', async () => {
      const ghPagesDir = path.join(tmpDir, 'gh-pages');
      const distDir = path.join(tmpDir, 'dist');
      const bundleDir = path.join(tmpDir, 'bundle');

      writeFile(ghPagesDir, 'pr-preview/pr-101/index.html', '<html>Old Closed PR</html>');
      writeFile(distDir, 'index.html', '<html><head></head><body>Landing</body></html>');
      writeFile(
        distDir,
        'quickstart/index.html',
        '<html><head></head><body>Quickstart</body></html>',
      );

      stagePreviewBundle({distDir, outDir: bundleDir, prNumber: 4055, headSha: SHA_A});

      const commentsByIssue = new Map([
        [
          101,
          [
            {
              id: 77,
              user: {login: 'github-actions[bot]', type: 'Bot'},
              body: formatActivePreviewComment({prNumber: 101, headSha: SHA_B}),
            },
          ],
        ],
        [4055, []],
      ]);
      const createdComments = [];
      const updatedComments = [];

      const paginatedEndpoints = [];
      const github = {
        paginate: async (fn, params) => {
          paginatedEndpoints.push(fn);
          return fn(params).then(r => r.data);
        },
        rest: {
          pulls: {
            list: async () => ({
              data: [
                {
                  number: 4055,
                  state: 'open',
                  head: {
                    ref: 'feat/docs-preview',
                    sha: SHA_A,
                    repo: {owner: {login: 'abdallahshaban557'}},
                  },
                },
              ],
            }),
            listFiles: async () => ({
              data: [{filename: 'docs/site/src/content/docs/quickstart.md', status: 'modified'}],
            }),
          },
          issues: {
            listComments: async ({issue_number}) => ({
              data: commentsByIssue.get(issue_number) || [],
            }),
            createComment: async ({issue_number, body}) => {
              createdComments.push({issue_number, body});
              return {data: {id: 88}};
            },
            updateComment: async ({comment_id, body}) => {
              updatedComments.push({comment_id, body});
              return {data: {id: comment_id}};
            },
          },
        },
      };

      const context = {
        eventName: 'workflow_run',
        repo: {owner: 'a2ui-project', repo: 'a2ui'},
        payload: {
          workflow_run: {
            id: 555,
            head_sha: SHA_A,
            head_branch: 'feat/docs-preview',
            head_repository: {owner: {login: 'abdallahshaban557'}},
            html_url: 'https://github.com/a2ui-project/a2ui/actions/runs/555',
            pull_requests: [],
          },
        },
      };

      const execGit = args => {
        if (args[0] === 'status') return 'M  pr-preview\n';
        return '';
      };

      const result = await reconcileDocsSitePreviews({
        github,
        context,
        ghPagesDir,
        bundleDir,
        execGit,
      });

      assert.equal(result.pushed, true);
      assert.equal(result.deployedPrNumber, 4055);
      assert.deepEqual(result.removedPrNumbers, [101]);
      assert.equal(paginatedEndpoints.includes(github.rest.pulls.listFiles), true);

      assert.equal(createdComments.length, 1);
      assert.equal(createdComments[0].issue_number, 4055);
      assert.match(createdComments[0].body, new RegExp(PREVIEW_COMMENT_MARKER));
      assert.match(createdComments[0].body, /https:\/\/a2ui\.org\/pr-preview\/pr-4055\//);
      assert.match(
        createdComments[0].body,
        /https:\/\/a2ui\.org\/pr-preview\/pr-4055\/quickstart\//,
      );

      assert.equal(updatedComments.length, 1);
      assert.equal(updatedComments[0].comment_id, 77);
      assert.equal(updatedComments[0].body, formatRemovedPreviewComment({prNumber: 101}));
    });

    it('rejects spoofed pr-metadata.json that mismatches GitHub API PR number', async () => {
      const ghPagesDir = path.join(tmpDir, 'gh-pages');
      const distDir = path.join(tmpDir, 'dist');
      const bundleDir = path.join(tmpDir, 'bundle');
      fs.mkdirSync(ghPagesDir, {recursive: true});
      writeFile(distDir, 'index.html', '<html><head></head></html>');

      // Attacker stages PR #9999 inside PR #4055's build
      stagePreviewBundle({distDir, outDir: bundleDir, prNumber: 9999, headSha: SHA_A});

      const paginatedEndpoints = [];
      const github = {
        paginate: async (fn, params) => {
          paginatedEndpoints.push(fn);
          return fn(params).then(r => r.data);
        },
        rest: {
          pulls: {
            list: async () => ({
              data: [
                {
                  number: 4055,
                  state: 'open',
                  head: {ref: 'evil', sha: SHA_A, repo: {owner: {login: 'attacker'}}},
                },
              ],
            }),
          },
        },
      };

      const context = {
        eventName: 'workflow_run',
        repo: {owner: 'a2ui-project', repo: 'a2ui'},
        payload: {
          workflow_run: {
            id: 666,
            head_sha: SHA_A,
            head_branch: 'evil',
            head_repository: {owner: {login: 'attacker'}},
            pull_requests: [],
          },
        },
      };

      await assert.rejects(
        () =>
          reconcileDocsSitePreviews({
            github,
            context,
            ghPagesDir,
            bundleDir,
            execGit: () => '',
          }),
        /does not match authoritative open PR/,
      );
    });
  });
});
