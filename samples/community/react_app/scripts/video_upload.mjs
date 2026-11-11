#!/usr/bin/env node
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

/**
 * Prepares demo videos and uploads them to GitHub `user-attachments`, the way dragging a file into
 * a comment box does, so the `https://github.com/user-attachments/assets/<id>` URL plays inline in
 * PR descriptions. See scripts/README.md.
 *
 * The upload drives the normal github.com page in a browser with a session the user created by
 * logging in themselves (`login`). It never reads browser cookie stores or tokens, never fills
 * the login form, and never submits the comment.
 */

import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, statSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {chromium} from 'playwright';
import {
  DEFAULT_MAX_MB,
  DEFAULT_TARGET,
  USAGE,
  ffmpegArgs,
  findAssetUrl,
  parseArgs,
  parseTime,
  sessionDir,
  sessionFile,
  targetVideoKbps,
} from './video_upload_lib.mjs';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

function log(message) {
  process.stderr.write(`${message}\n`);
}

/** The duration of a media file in seconds, from ffprobe. */
function probeDuration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    {encoding: 'utf8'},
  ).trim();
  const seconds = Number(out);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }
  // Playwright's .webm files often carry no duration header; decode to find it.
  const decoded = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-f', 'null', '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const times = [...String(decoded).matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times.at(-1);
  if (!last) {
    throw new Error(`Can't read the duration of ${file}.`);
  }
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

/** Converts a recording to an H.264 .mp4 under the size limit; returns the output path. */
export function prepare(input, options = {}) {
  if (!existsSync(input)) {
    throw new Error(`No such file: ${input}`);
  }
  const output = resolve(
    options.out ?? join(dirname(input), `${basename(input, extname(input))}.mp4`),
  );
  const maxMb = Number(options['max-mb'] ?? DEFAULT_MAX_MB);
  const start = parseTime(options.start);
  const end = parseTime(options.end);
  if (start !== undefined && end !== undefined && end <= start) {
    throw new Error('--end must be after --start.');
  }
  const full = probeDuration(input);
  const duration = (end ?? full) - (start ?? 0);
  const keepAudio = Boolean(options['keep-audio']);
  let videoKbps = targetVideoKbps(duration, maxMb, keepAudio ? 96 : 0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    execFileSync('ffmpeg', ffmpegArgs({input, output, start, end, videoKbps, keepAudio}), {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const sizeMb = statSync(output).size / (1024 * 1024);
    log(
      `Encoded ${output}: ${sizeMb.toFixed(2)} MiB, ${duration.toFixed(1)} s at ${videoKbps} kbit/s.`,
    );
    if (sizeMb <= maxMb) {
      return output;
    }
    videoKbps = Math.max(100, Math.floor((videoKbps * maxMb * 0.9) / sizeMb));
  }
  throw new Error(`Could not get ${output} under ${maxMb} MiB; trim it with --start/--end.`);
}

/** Opens a headed browser on the GitHub login page and saves the session once the user is in. */
export async function login(options = {}) {
  const browser = await chromium.launch({headless: false});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://github.com/login');
    log('Log in to GitHub in the browser window. This script waits until you are logged in.');
    await page.waitForFunction(
      () =>
        location.hostname === 'github.com' &&
        !/^\/(login|session|sessions)/.test(location.pathname) &&
        Boolean(document.querySelector('meta[name="user-login"]')?.getAttribute('content')),
      undefined,
      {timeout: Number(options.timeout ?? LOGIN_TIMEOUT_MS), polling: 1000},
    );
    const user = await page.locator('meta[name="user-login"]').getAttribute('content');
    mkdirSync(sessionDir(), {recursive: true, mode: 0o700});
    await context.storageState({path: sessionFile()});
    chmodSync(sessionFile(), 0o600);
    log(`Saved the session of ${user} in ${sessionFile()}.`);
  } finally {
    await browser.close();
  }
}

/** The comment box of the page: the markdown textarea that has a file input next to it. */
async function findCommentBox(page) {
  const textarea = page.locator('textarea').filter({visible: true}).first();
  await textarea.waitFor({state: 'visible', timeout: 30_000});
  // The nearest ancestor that also holds a file input is the editor the textarea belongs to.
  const fileInput = textarea
    .locator('xpath=ancestor::*[.//input[@type="file"]][1]')
    .locator('input[type="file"]')
    .first();
  return {textarea, fileInput};
}

/** Uploads a file through the comment box of `target` and returns the asset URL. */
export async function upload(file, options = {}) {
  if (!existsSync(file)) {
    throw new Error(`No such file: ${file}`);
  }
  const target = new URL(options.target ?? DEFAULT_TARGET);
  if (target.hostname !== 'github.com' && !options['allow-any-host']) {
    throw new Error(`--target must be a github.com page, not ${target.href}.`);
  }
  const state = options.session ?? sessionFile();
  if (!existsSync(state)) {
    throw new Error(
      `No GitHub session in ${state}. Run \`node scripts/video_upload.mjs login\` first and log in yourself.`,
    );
  }
  const browser = await chromium.launch({headless: !options.headed});
  try {
    const context = await browser.newContext({storageState: state});
    const page = await context.newPage();
    await page.goto(target.href);
    // GitHub names the logged-in user in a meta tag on every page; it is empty when logged out.
    const user = await page.evaluate(
      () => document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null,
    );
    if (!user) {
      throw new Error(
        'The saved GitHub session is logged out. Run `node scripts/video_upload.mjs login` again.',
      );
    }
    const {textarea, fileInput} = await findCommentBox(page);
    const before = await textarea.inputValue();
    await fileInput.setInputFiles(resolve(file));
    log(`Uploading ${basename(file)} as ${user} through ${target.href}…`);
    await page.waitForFunction(
      ({element, previous}) => {
        const value = element.value ?? '';
        return (
          value !== previous &&
          /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]{8,}/.test(value)
        );
      },
      {element: await textarea.elementHandle(), previous: before},
      {timeout: Number(options.timeout ?? UPLOAD_TIMEOUT_MS), polling: 500},
    );
    const url = findAssetUrl(await textarea.inputValue());
    // Leave nothing behind: clear the box so no draft is kept, and never submit.
    await textarea.fill(before);
    await page.close();
    if (!url) {
      throw new Error('GitHub did not return an asset URL.');
    }
    return url;
  } finally {
    await browser.close();
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    log(error.message);
    process.exitCode = 2;
    return;
  }
  const {command, file, options} = parsed;
  try {
    if (command === 'prepare') {
      process.stdout.write(`${prepare(file, options)}\n`);
    } else if (command === 'login') {
      await login(options);
    } else {
      const url = await upload(file, options);
      process.stdout.write(options.json ? `${JSON.stringify({file, url})}\n` : `${url}\n`);
    }
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export {USAGE};
