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

import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './components/App';
import {DemoSession} from './services/session';

const session = new DemoSession();

/** Read-only hooks for the Playwright tests and for poking around in the console. */
declare global {
  interface Window {
    demo: {
      session: DemoSession;
      turns: () => ReturnType<DemoSession['getTurns']>;
      bridge: (turnId: string) => ReturnType<ReturnType<DemoSession['bridgeLog']>['getEntries']>;
      dataModel: (surfaceId: string) => unknown;
    };
  }
}
window.demo = {
  session,
  turns: () => session.getTurns(),
  bridge: turnId => session.bridgeLog(turnId).getEntries(),
  dataModel: surfaceId => session.processor.model.getSurface(surfaceId)?.dataModel.get('/'),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
