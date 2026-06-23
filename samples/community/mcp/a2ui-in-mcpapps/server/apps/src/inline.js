/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const path = require('path');

const rawDir = path.join(__dirname, '../dist/raw/browser');
const fallbackDir = path.join(__dirname, '../dist/raw');
const outputDir = path.join(__dirname, '../public');
const outputFile = path.join(outputDir, 'app.html');

function getDir() {
  if (fs.existsSync(path.join(rawDir, 'index.html'))) return rawDir;
  if (fs.existsSync(path.join(fallbackDir, 'index.html'))) return fallbackDir;
  throw new Error('Could not find index.html in raw output directories.');
}

try {
  const buildDir = getDir();
  console.log(`Using build directory: ${buildDir}`);

  let indexHtml = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf-8');

  const files = fs.readdirSync(buildDir);
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const cssFiles = files.filter(f => f.endsWith('.css'));

  // Remove existing script tags that point to external files and replace with inlined content
  indexHtml = indexHtml.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (match, src) => {
    const filePath = path.join(buildDir, src);
    if (fs.existsSync(filePath)) {
      let content;
      if (src === 'main.js') {
        console.log(`Bundling and inlining JS: ${src}`);
        const bundledPath = path.join(buildDir, 'main.bundled.js');
        try {
          // CRITICAL: Modern Angular 17+ builds use ES module code-splitting by default.
          // While index.html only points to 'main.js', main.js relies on external relative chunks
          // (like markdown renderer, zones, etc.) which browsers block when run inside a sandboxed
          // 'srcdoc' iframe due to the lack of an accessible base origin.
          //
          // We use esbuild's explicit bundling feature here to automatically traverse all
          // ES module imports and merge the split chunks into ONE COMPLETELY SELF-CONTAINED monolithic JS file
          // before embedding it into the HTML body.
          require('child_process').execSync(
            `npx -y esbuild "${filePath}" --bundle --outfile="${bundledPath}" --format=esm --allow-overwrite`,
            {stdio: 'inherit'},
          );
          content = fs.readFileSync(bundledPath, 'utf-8');
        } catch (e) {
          console.warn(
            `Warning: bundling failed, falling back to original file. Error: ${e.message}`,
          );
          content = fs.readFileSync(filePath, 'utf-8');
        }
      } else {
        console.log(`Inlining JS: ${src}`);
        content = fs.readFileSync(filePath, 'utf-8');
      }
      // Remove source maps reference if any to reduce size or avoid errors
      const cleanedContent = content.replace(/\/\/# sourceMappingURL=.*\n?/g, '');
      return `<script type="module">${cleanedContent}</script>`;
    }
    return match;
  });

  // SCRUB: Angular automatically injects `<link rel="modulepreload">` for dynamic chunks.
  // Since we just forcibly bundled everything into main.js, these relative fetch requests will
  // throw noisy 404/CORS network errors inside the iframe if left in place.
  indexHtml = indexHtml.replace(/<link rel="modulepreload"[^>]+>/g, '');

  // Replace CSS links with style tags
  indexHtml = indexHtml.replace(
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (match, href) => {
      const filePath = path.join(buildDir, href);
      if (fs.existsSync(filePath)) {
        console.log(`Inlining CSS: ${href}`);
        const content = fs.readFileSync(filePath, 'utf-8');
        return `<style>${content}</style>`;
      }
      return match;
    },
  );

  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(outputFile, indexHtml);
  console.log(`Successfully inlined app to ${outputFile} (${fs.statSync(outputFile).size} bytes)`);
} catch (err) {
  console.error('Error during inlining:', err);
  process.exit(1);
}
