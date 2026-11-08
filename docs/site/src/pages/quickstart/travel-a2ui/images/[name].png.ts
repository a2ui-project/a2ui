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

// The quickstart's pictures at stable addresses, for coding agents.
//
// The pages use these images through Astro, which renames them with a content
// hash. An agent guide needs URLs that stay put, so each PNG in
// `src/assets/quickstart/travel-a2ui/` is also served, unchanged, as
// `quickstart/travel-a2ui/images/<name>.png`. `how-it-fits.png` is a
// screenshot of the HowItFits diagram: retake it when the diagram changes.

import fs from 'node:fs';
import path from 'node:path';
import type {APIRoute, GetStaticPaths} from 'astro';

const DIR = path.join(process.cwd(), 'src/assets/quickstart/travel-a2ui');

export const getStaticPaths: GetStaticPaths = () =>
  fs
    .readdirSync(DIR)
    .filter(file => file.endsWith('.png'))
    .map(file => ({params: {name: file.replace(/\.png$/, '')}}));

export const GET: APIRoute = ({params}) =>
  new Response(fs.readFileSync(path.join(DIR, `${params.name}.png`)), {
    headers: {'content-type': 'image/png'},
  });
