/*
 * Copyright 2025 Google LLC
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

import {registerSampleComponents} from '../register-components.js';
import type {OrgChart} from '../org-chart.js';

// Register custom components
registerSampleComponents();
console.log('Custom components registered');

customElements.whenDefined('org-chart').then(() => {
  const graph = document.getElementById('graph') as OrgChart;

  graph.chain = [
    {title: 'CEO', name: 'Alice Johnson'},
    {title: 'SVP', name: 'Bob Smith'},
    {title: 'VP', name: 'Charlie Brown'},
    {title: 'Director', name: 'Diana Prince'},
    {title: 'Software Engineer', name: 'Evan Wright'},
  ];

  graph.action = {
    name: 'showContactCard',
    context: [],
  };

  graph.addEventListener('a2uiaction', (e: any) => {
    const status = document.createElement('div');
    const clickedNodeTitle = e.detail.action.context.find((c: any) => c.key === 'clickedNodeTitle')
      ?.value.literalString;
    const clickedNodeName = e.detail.action.context.find((c: any) => c.key === 'clickedNodeName')
      ?.value.literalString;
    status.textContent = `Clicked: ${clickedNodeTitle} - ${clickedNodeName}`;
    status.style.marginTop = '20px';
    status.style.padding = '10px';
    status.style.background = '#e0f7fa';
    status.style.border = '1px solid #006064';
    status.id = 'action-status';
    document.body.appendChild(status);
  });
});
