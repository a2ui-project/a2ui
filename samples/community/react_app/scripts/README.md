# Scripts

## `video_upload.mjs`: demo videos for pull requests

Turns a Playwright recording into an `.mp4` that plays inline on GitHub, and uploads it to GitHub `user-attachments`, the storage behind files dragged into a comment box. The result is a `https://github.com/user-attachments/assets/<id>` URL to paste into a PR description.

GitHub has no API for these uploads, so the script uses the normal web page: it opens a GitHub page with a comment box in a browser, attaches the file through the box's file input, waits until GitHub writes the asset URL into the box, prints it, clears the box and closes the page. It never submits the comment.

```bash
cd samples/community/react_app

# 1. Convert: H.264, faststart, under 10 MiB (GitHub's limit for videos on free plans).
node scripts/video_upload.mjs prepare demo/e2e/test-results/run/video.webm --start 0:03 --end 1:10 --out /tmp/demo.mp4

# 2. Once: log in to GitHub yourself in the browser window that opens, then wait for "Saved the session".
node scripts/video_upload.mjs login

# 3. Upload and print the URL.
node scripts/video_upload.mjs upload /tmp/demo.mp4
```

`upload` options:

1. `--target <url>`: any github.com page with a comment box: an issue, a pull request or a new issue form. The default is the new issue form of `jacobsimionato/a2ui`; if that fork has issues turned off, pass an issue or PR URL instead.
2. `--headed`: show the browser.
3. `--json`: print `{"file", "url"}`.

`prepare` options: `--out`, `--start` and `--end` (seconds, `MM:SS` or `HH:MM:SS`), `--max-mb` (default 10) and `--keep-audio` (Playwright recordings have none, so audio is dropped by default). The script lowers the bitrate and encodes again if the first result is over the limit.

### The session

`login` opens a headed Chromium on `https://github.com/login`. You log in yourself, including any two-factor step. When the page shows you as logged in, the script saves Playwright's storage state to `~/.config/a2ui-video-upload/storage-state.json` (mode 600; override the directory with `A2UI_VIDEO_UPLOAD_DIR`), outside the repository. The script never fills the login form, never reads browser cookie stores, and never uses the `gh` token. When the session is missing or has expired, `upload` stops and asks you to run `login` again. Delete the file to forget the session.

### Tests

```bash
node scripts/video_upload.test.mjs
```

The tests cover everything except the real upload, which needs your login: argument parsing, the ffmpeg arguments, a real conversion of a generated `.webm` (codec, even dimensions, trim, size limit, faststart), and the upload flow against a local page that behaves like GitHub's comment box (placeholder, then asset URL, and no submit request). They need `ffmpeg` and `ffprobe` on the `PATH`, and Playwright's Chromium.
