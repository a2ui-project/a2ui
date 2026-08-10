/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {BootstrapContext, bootstrapApplication} from '@angular/platform-browser';
import {App} from './app/app';
import {config} from './app/app.config.server';

// This is the bootstrap file for server-side rendering (SSR).
// Unlike `main.ts` which runs in the browser, this file is executed by the Node.js server
// to render the initial HTML state before sending it to the client.
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
