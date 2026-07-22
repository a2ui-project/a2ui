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

import {AppConfig} from './types.js';
import {restaurantThemeSheet} from '../theme/restaurant-theme.js';

export const restaurantConfig: AppConfig = {
  key: 'restaurant',
  title: 'Restaurant Finder',
  heroImage: '/hero.png',
  heroImageDark: '/hero-dark.png',
  placeholder: 'Top 5 Chinese restaurants in New York.',
  loadingText: [
    'Finding the best spots for you...',
    'Checking reviews...',
    'Looking for open tables...',
    'Almost there...',
  ],
  serverUrl: 'http://localhost:10002',
  cssOverrides: restaurantThemeSheet,
};
