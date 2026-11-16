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

// Stages, deploys, comments on, and cleans up per-PR `docs/site` previews
// hosted under `https://a2ui.org/pr-preview/pr-<N>/` on the `gh-pages` branch.
//
// Security invariants:
// 1. Untrusted PR code runs only in the unprivileged `pull_request` workflow
//    (`docs_site_preview.yml`), which calls the `stage` CLI subcommand to
//    produce a static HTML bundle.
// 2. The privileged `docs_site_preview_deploy.yml` workflow always loads this
//    module from `main`, never checks out PR code, validates that the staged
//    bundle contains no symlinks or `.git` directories, and resolves the PR
//    number from GitHub's API rather than trusting artifact metadata alone.

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PREVIEW_COMMENT_MARKER = '<!-- a2ui-docs-site-preview -->';
export const PREVIEW_SUBDIR = 'pr-preview';
export const SITE_ORIGIN = 'https://a2ui.org';
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
export const MAX_CHANGED_PAGE_LINKS = 10;

const NOINDEX_META_TAG = '<meta name="robots" content="noindex, nofollow">';
const GIT_BOT_NAME = 'github-actions[bot]';
const GIT_BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

export const isBot = user =>
  Boolean(user) && (user.type === 'Bot' || /\[bot\]$/.test(user.login || ''));

function parsePositivePrNumber(value) {
  const trimmed = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid pull request number: "${value}"`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Pull request number out of range: "${value}"`);
  }
  return parsed;
}

function validateHeadSha(value) {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(trimmed)) {
    throw new Error(`Invalid 40-character git commit SHA: "${value}"`);
  }
  return trimmed;
}

/**
 * Verifies that `siteDir` is a real directory containing `index.html`, has no
 * symbolic links, special files, or `.git` directories, and stays within
 * `maxBytes`.
 */
export function validateSiteDirectory(siteDir, {maxBytes = MAX_BUNDLE_BYTES} = {}) {
  if (!fs.existsSync(siteDir)) {
    throw new Error(`Preview site directory does not exist: ${siteDir}`);
  }
  const rootStat = fs.lstatSync(siteDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Preview site root must be a regular directory: ${siteDir}`);
  }

  let totalBytes = 0;

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git') {
        throw new Error(`Forbidden .git entry inside preview bundle: ${path.join(dir, name)}`);
      }
      const fullPath = path.join(dir, name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symbolic links are forbidden in preview bundle: ${fullPath}`);
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > maxBytes) {
          throw new Error(`Preview bundle exceeds size limit (${totalBytes} > ${maxBytes} bytes)`);
        }
      } else {
        throw new Error(`Unsupported special file in preview bundle: ${fullPath}`);
      }
    }
  }

  walk(siteDir);

  const indexHtml = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexHtml) || !fs.lstatSync(indexHtml).isFile()) {
    throw new Error(`Preview site directory is missing root index.html: ${siteDir}`);
  }

  return totalBytes;
}

/**
 * Inserts `<meta name="robots" content="noindex, nofollow">` into an HTML
 * document's `<head>` if no `robots` meta tag is already present.
 */
export function injectNoindexMeta(html) {
  if (/<meta\b[^>]*\bname\s*=\s*["']robots["']/i.test(html)) {
    return html;
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${NOINDEX_META_TAG}\n</head>`);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, match => `${match}\n${NOINDEX_META_TAG}`);
  }
  return html;
}

function applyNoindexToHtmlTree(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      applyNoindexToHtmlTree(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const original = fs.readFileSync(fullPath, 'utf8');
      const updated = injectNoindexMeta(original);
      if (updated !== original) {
        fs.writeFileSync(fullPath, updated, 'utf8');
      }
    }
  }
}

/**
 * Stages `distDir` into `outDir/site` (stripping root `CNAME`/`.nojekyll` and
 * marking all HTML pages `noindex, nofollow`) alongside `outDir/pr-metadata.json`.
 */
export function stagePreviewBundle({
  distDir,
  outDir,
  prNumber,
  headSha,
  maxBytes = MAX_BUNDLE_BYTES,
}) {
  if (typeof distDir !== 'string' || !distDir.trim()) {
    throw new Error('distDir must be a non-empty path string');
  }
  if (typeof outDir !== 'string' || !outDir.trim()) {
    throw new Error('outDir must be a non-empty path string');
  }

  const resolvedDist = path.resolve(distDir);
  const resolvedOut = path.resolve(outDir);
  const cwd = path.resolve(process.cwd());
  const rootDir = path.parse(resolvedOut).root;

  if (
    resolvedOut === rootDir ||
    resolvedOut === cwd ||
    cwd.startsWith(`${resolvedOut}${path.sep}`) ||
    resolvedOut === resolvedDist ||
    resolvedDist.startsWith(`${resolvedOut}${path.sep}`)
  ) {
    throw new Error(`Refusing to stage preview bundle into unsafe directory: ${resolvedOut}`);
  }

  const parsedPr = parsePositivePrNumber(prNumber);
  const normalizedSha = validateHeadSha(headSha);

  validateSiteDirectory(resolvedDist, {maxBytes});

  fs.rmSync(resolvedOut, {recursive: true, force: true});
  const stagedSiteDir = path.join(resolvedOut, 'site');
  fs.mkdirSync(resolvedOut, {recursive: true});
  fs.cpSync(resolvedDist, stagedSiteDir, {recursive: true, verbatimSymlinks: true});

  fs.rmSync(path.join(stagedSiteDir, 'CNAME'), {force: true});
  fs.rmSync(path.join(stagedSiteDir, '.nojekyll'), {force: true});
  applyNoindexToHtmlTree(stagedSiteDir);

  validateSiteDirectory(stagedSiteDir, {maxBytes});

  const metadata = {
    pr_number: parsedPr,
    head_sha: normalizedSha,
  };
  fs.writeFileSync(
    path.join(resolvedOut, 'pr-metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  return metadata;
}

/**
 * Resolves the authoritative open pull request for a `workflow_run` event.
 *
 * GitHub often omits `workflow_run.pull_requests` for pull requests originating
 * from forks, so this falls back to matching `head_repository.owner.login` +
 * `head_branch` (and then `head_sha`) against the repository's open PRs.
 */
export function resolveWorkflowRunPr({workflowRun, openPrs, repoFullName}) {
  if (!workflowRun) {
    return {pr: null, stale: false, reason: 'missing_workflow_run'};
  }

  const openByNumber = new Map(openPrs.map(pr => [pr.number, pr]));
  let matchedPr = null;

  for (const refPr of workflowRun.pull_requests || []) {
    const baseFullName = refPr.base?.repo?.full_name;
    if (baseFullName && repoFullName && baseFullName !== repoFullName) {
      continue;
    }
    const candidate = openByNumber.get(refPr.number);
    if (candidate) {
      matchedPr = candidate;
      break;
    }
  }

  if (!matchedPr) {
    const headOwner = workflowRun.head_repository?.owner?.login;
    const headBranch = workflowRun.head_branch;
    if (headOwner && headBranch) {
      matchedPr =
        openPrs.find(
          pr => pr.head?.repo?.owner?.login === headOwner && pr.head?.ref === headBranch,
        ) || null;
    }
  }

  if (!matchedPr && workflowRun.head_sha) {
    matchedPr =
      openPrs.find(
        pr =>
          String(pr.head?.sha || '').toLowerCase() === String(workflowRun.head_sha).toLowerCase(),
      ) || null;
  }

  if (!matchedPr) {
    return {pr: null, stale: false, reason: 'closed_or_not_found'};
  }

  const runSha = String(workflowRun.head_sha || '').toLowerCase();
  const currentPrSha = String(matchedPr.head?.sha || '').toLowerCase();
  if (runSha && currentPrSha && runSha !== currentPrSha) {
    return {pr: matchedPr, stale: true, reason: 'stale_sha'};
  }

  return {pr: matchedPr, stale: false, reason: 'matched'};
}

function candidateRoutesForChangedFile(filePath) {
  const normalized = String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (normalized === 'docs/site/src/pages/index.astro') {
    return ['/'];
  }
  const customPageMatch = /^docs\/site\/src\/pages\/([A-Za-z0-9/_-]+)\.astro$/.exec(normalized);
  if (customPageMatch && customPageMatch[1] !== '404') {
    const slug = customPageMatch[1].replace(/\/index$/, '');
    return [`/${slug}/`];
  }

  const contentDocMatch = /^docs\/site\/src\/content\/docs\/(.+)\.(?:md|mdx)$/.exec(normalized);
  if (contentDocMatch) {
    const rawSlug = contentDocMatch[1];
    if (rawSlug === 'index') {
      return ['/'];
    }
    const schemaWrapperMatch = /^specification\/(v\d+\.\d+(?:\.\d+)?)-schemas$/.exec(rawSlug);
    if (schemaWrapperMatch) {
      return [`/specification/${schemaWrapperMatch[1]}/schemas/`];
    }
    const cleanSlug = rawSlug.replace(/\/index$/, '');
    return [`/${cleanSlug}/`];
  }

  const specJsonMatch = /^specification\/(v\d+_\d+(?:_\d+)?)\/json\/.+\.json$/.exec(normalized);
  if (specJsonMatch) {
    const dotVer = specJsonMatch[1].replace(/_/g, '.');
    return [`/specification/${dotVer}/schemas/`];
  }

  const specDocMatch = /^specification\/(v\d+_\d+(?:_\d+)?)\/docs\/([A-Za-z0-9_-]+)\.md$/.exec(
    normalized,
  );
  if (specDocMatch) {
    const dotVer = specDocMatch[1].replace(/_/g, '.');
    const docBase = specDocMatch[2];
    if (docBase === 'a2ui_protocol') {
      return [`/specification/${dotVer}-a2ui/`];
    }
    return [`/specification/${dotVer}-${docBase.replace(/_/g, '-')}/`];
  }

  if (normalized.startsWith('catalogs/basic/v1/')) {
    return ['/specification/v1.0-basic-catalog-implementation-guide/'];
  }
  if (normalized.startsWith('catalogs/mcp/v1/')) {
    return ['/guides/mcp-catalog/'];
  }

  return [];
}

/**
 * Maps modified PR files to built preview URLs, returning only routes whose
 * corresponding HTML file actually exists inside `previewSiteDir`.
 */
export function collectChangedPreviewLinks({
  prFiles,
  previewSiteDir,
  prNumber,
  siteOrigin = SITE_ORIGIN,
  maxLinks = MAX_CHANGED_PAGE_LINKS,
}) {
  const parsedPr = parsePositivePrNumber(prNumber);
  const cleanOrigin = siteOrigin.replace(/\/+$/, '');
  const seenRoutes = new Set();
  const links = [];

  for (const file of prFiles || []) {
    if (file.status === 'removed') continue;
    for (const route of candidateRoutesForChangedFile(file.filename)) {
      if (seenRoutes.has(route)) continue;
      const relHtml =
        route === '/' ? 'index.html' : path.join(route.replace(/^\/+|\/+$/g, ''), 'index.html');
      const absHtml = path.join(previewSiteDir, relHtml);
      if (fs.existsSync(absHtml) && fs.lstatSync(absHtml).isFile()) {
        seenRoutes.add(route);
        links.push({
          route,
          url: `${cleanOrigin}/${PREVIEW_SUBDIR}/pr-${parsedPr}${route}`,
        });
        if (links.length >= maxLinks) {
          return links;
        }
      }
    }
  }

  return links;
}

/**
 * Updates `ghPagesDir/pr-preview/` on disk: deploys `deploy` (if provided) and
 * deletes any `pr-<M>` subdirectories whose PR number is not in `openPrNumbers`.
 */
export function syncGhPagesPreviewTree({
  ghPagesDir,
  openPrNumbers,
  deploy = null,
  maxBytes = MAX_BUNDLE_BYTES,
}) {
  const openSet = new Set(openPrNumbers.map(n => parsePositivePrNumber(n)));
  const previewRoot = path.join(ghPagesDir, PREVIEW_SUBDIR);
  let deployedPrNumber = null;

  const nojekyllPath = path.join(ghPagesDir, '.nojekyll');
  if (!fs.existsSync(nojekyllPath)) {
    fs.writeFileSync(nojekyllPath, '');
  }

  if (deploy) {
    const parsedPr = parsePositivePrNumber(deploy.prNumber);
    validateSiteDirectory(deploy.siteDir, {maxBytes});
    fs.mkdirSync(previewRoot, {recursive: true});
    const destDir = path.join(previewRoot, `pr-${parsedPr}`);
    fs.rmSync(destDir, {recursive: true, force: true});
    fs.cpSync(deploy.siteDir, destDir, {recursive: true, verbatimSymlinks: true});
    fs.rmSync(path.join(destDir, 'CNAME'), {force: true});
    fs.rmSync(path.join(destDir, '.nojekyll'), {force: true});
    deployedPrNumber = parsedPr;
    openSet.add(parsedPr);
  }

  const removedPrNumbers = [];
  if (fs.existsSync(previewRoot)) {
    for (const entry of fs.readdirSync(previewRoot, {withFileTypes: true})) {
      const match = /^pr-([1-9]\d*)$/.exec(entry.name);
      if (!match) continue;
      const prNum = Number.parseInt(match[1], 10);
      if (!openSet.has(prNum)) {
        fs.rmSync(path.join(previewRoot, entry.name), {recursive: true, force: true});
        removedPrNumbers.push(prNum);
      }
    }
    if (fs.readdirSync(previewRoot).length === 0) {
      fs.rmSync(previewRoot, {recursive: true, force: true});
    }
  }

  removedPrNumbers.sort((a, b) => a - b);
  return {deployedPrNumber, removedPrNumbers};
}

function defaultExecGit(ghPagesDir) {
  return args =>
    execFileSync('git', args, {
      cwd: ghPagesDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function buildCommitMessage({deployedPrNumber, headSha, removedPrNumbers}) {
  const parts = [];
  if (deployedPrNumber !== null) {
    const shortSha = headSha ? ` (${headSha.slice(0, 7)})` : '';
    parts.push(`Deploy docs/site preview for PR #${deployedPrNumber}${shortSha}`);
  }
  if (removedPrNumbers.length > 0) {
    const list = removedPrNumbers.map(n => `#${n}`).join(', ');
    parts.push(`prune closed PR previews (${list})`);
  }
  const message = parts.join('; ') || 'Reconcile docs/site PR previews';
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Applies `syncGhPagesPreviewTree`, commits `.nojekyll` and `pr-preview/`, and
 * pushes to `origin/gh-pages` with automatic fetch+reset retries on conflict.
 */
export function commitAndPushGhPages({
  ghPagesDir,
  openPrNumbers,
  deploy = null,
  maxAttempts = 3,
  execGit = defaultExecGit(ghPagesDir),
}) {
  execGit(['config', '--local', 'user.name', GIT_BOT_NAME]);
  execGit(['config', '--local', 'user.email', GIT_BOT_EMAIL]);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      execGit(['fetch', 'origin', 'gh-pages', '--depth=1']);
      execGit(['reset', '--hard', 'origin/gh-pages']);
      execGit(['clean', '-fd']);
    }

    const syncResult = syncGhPagesPreviewTree({ghPagesDir, openPrNumbers, deploy});
    const hasPreviewPath =
      fs.existsSync(path.join(ghPagesDir, PREVIEW_SUBDIR)) ||
      Boolean(execGit(['ls-files', '--', PREVIEW_SUBDIR]).trim());
    const managedPaths = hasPreviewPath ? ['.nojekyll', PREVIEW_SUBDIR] : ['.nojekyll'];

    execGit(['add', '-A', '--', ...managedPaths]);

    const stagedStatus = execGit(['status', '--porcelain', '--', ...managedPaths]);
    if (!stagedStatus.trim()) {
      return {pushed: false, ...syncResult};
    }

    const commitMsg = buildCommitMessage({
      deployedPrNumber: syncResult.deployedPrNumber,
      headSha: deploy?.headSha,
      removedPrNumbers: syncResult.removedPrNumbers,
    });
    execGit(['commit', '-m', commitMsg]);

    try {
      execGit(['push', 'origin', 'HEAD:gh-pages']);
      return {pushed: true, ...syncResult};
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.warn(
        `[docs-site-preview] Push attempt ${attempt}/${maxAttempts} failed; refetching gh-pages and retrying.`,
      );
    }
  }

  throw new Error('Unreachable: maxAttempts must be >= 1');
}

export function formatActivePreviewComment({
  prNumber,
  headSha,
  runUrl,
  changedLinks = [],
  siteOrigin = SITE_ORIGIN,
}) {
  const parsedPr = parsePositivePrNumber(prNumber);
  const cleanOrigin = siteOrigin.replace(/\/+$/, '');
  const previewRootUrl = `${cleanOrigin}/${PREVIEW_SUBDIR}/pr-${parsedPr}/`;
  const shortSha = String(headSha || '').slice(0, 7);

  const lines = [
    PREVIEW_COMMENT_MARKER,
    '### 📖 Docs Site Preview Deployed',
    '',
    `Preview URL: **${previewRootUrl}**`,
  ];

  if (changedLinks.length > 0) {
    lines.push('', '**Modified pages in this PR:**');
    for (const {route, url} of changedLinks) {
      lines.push(`- [\`${route}\`](${url})`);
    }
  }

  const metaParts = [];
  if (shortSha) metaParts.push(`Built from commit \`${shortSha}\``);
  if (runUrl) metaParts.push(`[Workflow run](${runUrl})`);
  metaParts.push(
    'GitHub Pages may take ~30–60s to propagate updates. This preview is removed automatically when the PR closes.',
  );

  lines.push('', `<sub>${metaParts.join(' · ')}</sub>`);
  return lines.join('\n');
}

export function formatRemovedPreviewComment({prNumber}) {
  const parsedPr = parsePositivePrNumber(prNumber);
  return [
    PREVIEW_COMMENT_MARKER,
    '### 🧹 Docs Site Preview Removed',
    '',
    `The preview for PR #${parsedPr} has been cleaned up because the pull request is closed.`,
  ].join('\n');
}

async function findExistingPreviewComment({github, owner, repo, prNumber}) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  return (
    comments.find(
      comment => isBot(comment.user) && comment.body?.includes(PREVIEW_COMMENT_MARKER),
    ) || null
  );
}

export async function upsertPreviewComment({github, owner, repo, prNumber, body}) {
  const existing = await findExistingPreviewComment({github, owner, repo, prNumber});
  if (existing) {
    if (existing.body === body) return {action: 'unchanged', commentId: existing.id};
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    return {action: 'updated', commentId: existing.id};
  }
  const created = await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return {action: 'created', commentId: created.data.id};
}

export async function markPreviewRemovedComment({github, owner, repo, prNumber}) {
  const existing = await findExistingPreviewComment({github, owner, repo, prNumber});
  if (!existing) return {action: 'none', commentId: null};

  const body = formatRemovedPreviewComment({prNumber});
  if (existing.body === body) return {action: 'unchanged', commentId: existing.id};

  await github.rest.issues.updateComment({
    owner,
    repo,
    comment_id: existing.id,
    body,
  });
  return {action: 'updated', commentId: existing.id};
}

/**
 * Main entrypoint invoked via `actions/github-script` in
 * `.github/workflows/docs_site_preview_deploy.yml`.
 */
export default async function reconcileDocsSitePreviews({
  github,
  context,
  ghPagesDir,
  bundleDir = null,
  siteOrigin = SITE_ORIGIN,
  execGit,
}) {
  const {owner, repo} = context.repo;
  const repoFullName = `${owner}/${repo}`;

  const openPrs = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  const openPrNumbers = openPrs.map(pr => pr.number);

  let deployTarget = null;

  if (context.eventName === 'workflow_run') {
    if (!bundleDir) {
      throw new Error('bundleDir is required when handling a workflow_run event');
    }
    const metadataPath = path.join(bundleDir, 'pr-metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Missing pr-metadata.json in downloaded artifact: ${metadataPath}`);
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const artifactPrNumber = parsePositivePrNumber(metadata.pr_number);
    const artifactSha = validateHeadSha(metadata.head_sha);

    const workflowRun = context.payload.workflow_run;
    const runSha = validateHeadSha(workflowRun?.head_sha);
    if (artifactSha !== runSha) {
      throw new Error(
        `Artifact head_sha (${artifactSha}) does not match workflow_run.head_sha (${runSha})`,
      );
    }

    const resolution = resolveWorkflowRunPr({workflowRun, openPrs, repoFullName});
    if (!resolution.pr) {
      console.log(
        `[docs-site-preview] PR for workflow_run ${workflowRun?.id} is no longer open (${resolution.reason}); skipping deploy.`,
      );
    } else if (resolution.pr.number !== artifactPrNumber) {
      throw new Error(
        `Artifact pr_number (#${artifactPrNumber}) does not match authoritative open PR (#${resolution.pr.number})`,
      );
    } else if (resolution.stale) {
      console.log(
        `[docs-site-preview] Skipping stale build ${artifactSha.slice(0, 7)} for PR #${resolution.pr.number} (head is now ${String(resolution.pr.head?.sha || '').slice(0, 7)}).`,
      );
    } else {
      deployTarget = {
        prNumber: resolution.pr.number,
        headSha: artifactSha,
        siteDir: path.join(bundleDir, 'site'),
        runUrl: workflowRun?.html_url || null,
      };
    }
  }

  const pushResult = commitAndPushGhPages({
    ghPagesDir,
    openPrNumbers,
    deploy: deployTarget,
    execGit,
  });

  if (deployTarget) {
    let prFiles = [];
    try {
      prFiles = await github.paginate(github.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: deployTarget.prNumber,
        per_page: 100,
      });
    } catch (error) {
      console.warn(
        `[docs-site-preview] Could not list modified files for PR #${deployTarget.prNumber}: ${error.message}`,
      );
    }

    const changedLinks = collectChangedPreviewLinks({
      prFiles,
      previewSiteDir: deployTarget.siteDir,
      prNumber: deployTarget.prNumber,
      siteOrigin,
    });
    const body = formatActivePreviewComment({
      prNumber: deployTarget.prNumber,
      headSha: deployTarget.headSha,
      runUrl: deployTarget.runUrl,
      changedLinks,
      siteOrigin,
    });
    await upsertPreviewComment({
      github,
      owner,
      repo,
      prNumber: deployTarget.prNumber,
      body,
    });
  }

  for (const removedPrNumber of pushResult.removedPrNumbers) {
    try {
      await markPreviewRemovedComment({
        github,
        owner,
        repo,
        prNumber: removedPrNumber,
      });
    } catch (error) {
      console.warn(
        `[docs-site-preview] Could not update closed preview comment on PR #${removedPrNumber}: ${error.message}`,
      );
    }
  }

  return pushResult;
}

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[arg.slice(2)] = argv[++i];
    }
  }
  return flags;
}

export function runCli(argv) {
  const [command, ...rest] = argv;
  if (command !== 'stage') {
    throw new Error(
      `Usage: node scripts/docs_site_preview.mjs stage --dist <dir> --out <dir> --pr <number> --sha <40-hex-sha>`,
    );
  }
  const flags = parseCliFlags(rest);
  if (!flags.dist?.trim() || !flags.out?.trim() || !flags.pr?.trim() || !flags.sha?.trim()) {
    throw new Error(
      'Missing required flags: --dist, --out, --pr, and --sha must all be specified and non-empty.',
    );
  }
  const metadata = stagePreviewBundle({
    distDir: path.resolve(flags.dist),
    outDir: path.resolve(flags.out),
    prNumber: flags.pr,
    headSha: flags.sha,
  });
  console.log(
    `[docs-site-preview] Staged preview bundle for PR #${metadata.pr_number} (${metadata.head_sha.slice(0, 7)}).`,
  );
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`[docs-site-preview] Error: ${error.message}`);
    process.exit(1);
  }
}
