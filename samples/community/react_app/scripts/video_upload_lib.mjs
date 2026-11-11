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
 * The pieces of `video_upload.mjs` that need neither a browser nor a network, so they can be
 * tested on their own: argument parsing, ffmpeg arguments, and finding the uploaded asset URL.
 */

import {homedir} from 'node:os';
import {join} from 'node:path';

/** Where the GitHub session lives: outside the repository, readable by the user only. */
export function sessionDir(env = process.env) {
  return env.A2UI_VIDEO_UPLOAD_DIR || join(env.HOME || homedir(), '.config', 'a2ui-video-upload');
}

/** The Playwright storage state of the session. */
export function sessionFile(env = process.env) {
  return join(sessionDir(env), 'storage-state.json');
}

/** The default page whose comment box receives the upload. The comment is never submitted. */
export const DEFAULT_TARGET = 'https://github.com/jacobsimionato/a2ui/issues/new';

/** GitHub's limit for videos on free plans, in MiB. */
export const DEFAULT_MAX_MB = 10;

const ASSET_URL = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]{8,}/;

/** The first `user-attachments` asset URL in a comment box's text, or null. */
export function findAssetUrl(text) {
  return ASSET_URL.exec(text ?? '')?.[0] ?? null;
}

/** Parses `HH:MM:SS(.ms)`, `MM:SS` or seconds into seconds. */
export function parseTime(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parts = String(value).split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0) || parts.length > 3) {
    throw new Error(`Invalid time "${value}"; use seconds, MM:SS or HH:MM:SS.`);
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const USAGE = `Usage:
  node scripts/video_upload.mjs prepare <input.webm> [--out <file.mp4>] [--start <time>] [--end <time>] [--max-mb 10]
  node scripts/video_upload.mjs login
  node scripts/video_upload.mjs upload <file.mp4> [--target <github page with a comment box>] [--headed] [--json]

prepare  Converts a Playwright .webm into an .mp4 (H.264, faststart) under --max-mb MiB.
login    Opens a browser window. Log in to GitHub yourself; the script saves the session once you are in.
         The session is saved in ${sessionFile()}.
upload   Attaches the file to the comment box of --target (default ${DEFAULT_TARGET}),
         waits for GitHub's https://github.com/user-attachments/assets/<id> URL, prints it,
         clears the box and closes the page. It never submits the comment.`;

export {USAGE};

/**
 * Parses the command line into `{command, file, options}`.
 *
 * @throws {Error} With the usage text for an unknown command or a missing file.
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (['headed', 'json', 'keep-audio', 'allow-any-host'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = rest[++index];
    if (value === undefined) {
      throw new Error(`--${name} needs a value.\n\n${USAGE}`);
    }
    options[name] = value;
  }
  if (!['prepare', 'login', 'upload'].includes(command)) {
    throw new Error(USAGE);
  }
  if (command !== 'login' && positional.length !== 1) {
    throw new Error(`${command} needs one file.\n\n${USAGE}`);
  }
  return {command, file: positional[0], options};
}

/**
 * The video bitrate, in kbit/s, that keeps `durationSeconds` of video under `maxMb` MiB, with
 * 5% for the container and `audioKbps` for audio.
 */
export function targetVideoKbps(durationSeconds, maxMb, audioKbps = 0) {
  if (!(durationSeconds > 0)) {
    throw new Error('The video has no duration.');
  }
  const totalKbps = (maxMb * 1024 * 1024 * 8 * 0.95) / durationSeconds / 1000;
  return Math.max(150, Math.floor(totalKbps - audioKbps));
}

/** The ffmpeg arguments of one encode. */
export function ffmpegArgs({input, output, start, end, videoKbps, keepAudio = false}) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (start !== undefined) {
    args.push('-ss', String(start));
  }
  args.push('-i', input);
  if (end !== undefined) {
    // After -ss, -t is measured from the new start.
    args.push('-t', String(end - (start ?? 0)));
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    // H.264 needs even dimensions.
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-b:v',
    `${videoKbps}k`,
    '-maxrate',
    `${Math.round(videoKbps * 1.5)}k`,
    '-bufsize',
    `${videoKbps * 2}k`,
    '-movflags',
    '+faststart',
  );
  if (keepAudio) {
    args.push('-c:a', 'aac', '-b:a', '96k');
  } else {
    args.push('-an');
  }
  args.push(output);
  return args;
}

/** Whether an MP4 buffer has its `moov` atom before `mdat` (faststart). */
export function isFaststart(buffer) {
  const moov = buffer.indexOf('moov');
  const mdat = buffer.indexOf('mdat');
  return moov !== -1 && (mdat === -1 || moov < mdat);
}
