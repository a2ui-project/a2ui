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
 * Tests of the video tool: everything except the real GitHub upload, which needs the user's
 * login. The upload flow runs against a local page that behaves like GitHub's comment box.
 * Run with `node --test scripts/`.
 */

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import {prepare, upload} from './video_upload.mjs';
import {
  DEFAULT_TARGET,
  ffmpegArgs,
  findAssetUrl,
  isFaststart,
  parseArgs,
  parseTime,
  sessionFile,
  targetVideoKbps,
} from './video_upload_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'a2ui-video-'));

describe('argument parsing', () => {
  it('reads the commands, the file and the options', () => {
    assert.deepEqual(parseArgs(['prepare', 'a.webm', '--start', '2', '--max-mb', '5']), {
      command: 'prepare',
      file: 'a.webm',
      options: {start: '2', 'max-mb': '5'},
    });
    assert.deepEqual(parseArgs(['upload', 'a.mp4', '--headed', '--json']), {
      command: 'upload',
      file: 'a.mp4',
      options: {headed: true, json: true},
    });
    assert.deepEqual(parseArgs(['login']), {command: 'login', file: undefined, options: {}});
  });

  it('rejects unknown commands, missing files and options without values', () => {
    assert.throws(() => parseArgs(['publish', 'a.mp4']), /Usage/);
    assert.throws(() => parseArgs(['upload']), /needs one file/);
    assert.throws(() => parseArgs(['prepare', 'a.webm', '--start']), /needs a value/);
  });

  it('parses times', () => {
    assert.equal(parseTime('90'), 90);
    assert.equal(parseTime('1:30'), 90);
    assert.equal(parseTime('01:00:02.5'), 3602.5);
    assert.equal(parseTime(undefined), undefined);
    assert.throws(() => parseTime('a:b'), /Invalid time/);
  });
});

describe('helpers', () => {
  it('keeps the session outside the repository', () => {
    assert.equal(
      sessionFile({HOME: '/home/u'}),
      '/home/u/.config/a2ui-video-upload/storage-state.json',
    );
    assert.equal(sessionFile({A2UI_VIDEO_UPLOAD_DIR: '/tmp/s'}), '/tmp/s/storage-state.json');
    assert.match(DEFAULT_TARGET, /^https:\/\/github\.com\//);
  });

  it('finds the asset URL in a comment box', () => {
    assert.equal(
      findAssetUrl('text\n![x](https://github.com/user-attachments/assets/1f0e2d3c-4b5a-6978)\n'),
      'https://github.com/user-attachments/assets/1f0e2d3c-4b5a-6978',
    );
    assert.equal(findAssetUrl('![Uploading demo.mp4…]()'), null);
  });

  it('sizes the bitrate to the limit', () => {
    // 10 MiB over 60 s, minus 5% for the container: about 1328 kbit/s.
    assert.equal(targetVideoKbps(60, 10), 1328);
    assert.equal(targetVideoKbps(60, 10, 96), 1232);
    assert.equal(targetVideoKbps(100000, 10), 150);
    assert.throws(() => targetVideoKbps(0, 10), /no duration/);
  });

  it('builds H.264 faststart ffmpeg arguments with an optional trim', () => {
    const args = ffmpegArgs({
      input: 'in.webm',
      output: 'out.mp4',
      start: 2,
      end: 7,
      videoKbps: 800,
    });

    assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '2']);
    assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '5']);
    for (const pair of [
      ['-c:v', 'libx264'],
      ['-movflags', '+faststart'],
      ['-b:v', '800k'],
    ]) {
      assert.equal(args[args.indexOf(pair[0]) + 1], pair[1]);
    }
    assert.ok(args.includes('-an'));
    assert.equal(args.at(-1), 'out.mp4');
  });
});

describe('prepare', () => {
  it('converts a Playwright-style webm to a trimmed H.264 mp4 under the limit', () => {
    const input = join(work, 'recording.webm');
    execFileSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1281x721:rate=25:duration=6',
      '-c:v',
      'libvpx',
      '-b:v',
      '2M',
      input,
    ]);

    const output = prepare(input, {
      out: join(work, 'demo.mp4'),
      start: '1',
      end: '4',
      'max-mb': '1',
    });

    assert.ok(statSync(output).size <= 1024 * 1024);
    assert.ok(isFaststart(readFileSync(output)));
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,width,height:format=duration',
          '-of',
          'json',
          output,
        ],
        {encoding: 'utf8'},
      ),
    );
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].width % 2, 0);
    assert.equal(probe.streams.length, 1);
    assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.3, probe.format.duration);
  });

  it('refuses a missing file and an end before the start', () => {
    assert.throws(() => prepare(join(work, 'missing.webm')), /No such file/);
    const input = join(work, 'recording.webm');
    assert.throws(() => prepare(input, {start: '4', end: '2'}), /--end must be after --start/);
  });
});

describe('upload (against a fake comment box)', () => {
  let server;
  let origin;
  const requests = [];
  const page = readFileSync(join(here, 'fixtures', 'fake_github_comment.html'), 'utf8');
  const session = join(work, 'storage-state.json');
  const video = join(work, 'clip.mp4');

  before(async () => {
    writeFileSync(session, JSON.stringify({cookies: [], origins: []}));
    writeFileSync(video, Buffer.alloc(2048, 1));
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      const html = req.url.startsWith('/logged-out')
        ? page.replace(/<meta name="user-login"[^>]*>/, '')
        : page;
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('attaches the file, waits for the asset URL, and never submits', async () => {
    const url = await upload(video, {
      target: `${origin}/issues/new`,
      session,
      'allow-any-host': true,
      timeout: 10_000,
    });

    assert.equal(
      url,
      'https://github.com/user-attachments/assets/1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
    );
    assert.deepEqual(
      requests.filter(r => !r.startsWith('GET /favicon')),
      ['GET /issues/new'],
    );
  });

  it('refuses non-GitHub targets unless told otherwise', async () => {
    await assert.rejects(
      upload(video, {target: `${origin}/x`, session}),
      /must be a github\.com page/,
    );
  });

  it('asks for login when there is no session or it is logged out', async () => {
    await assert.rejects(
      upload(video, {session: join(work, 'none.json')}),
      /Run `node scripts\/video_upload.mjs login` first/,
    );
    await assert.rejects(
      upload(video, {target: `${origin}/logged-out`, session, 'allow-any-host': true}),
      /logged out/,
    );
  });
});
