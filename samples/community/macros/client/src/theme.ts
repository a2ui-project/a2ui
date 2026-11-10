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

import type {CSSProperties} from 'react';

export const A2UI_THEME_VARS: CSSProperties = {
  // Card & Container
  ['--a2ui-card-border-radius' as any]: '16px',
  ['--a2ui-card-background' as any]: '#ffffff',
  ['--a2ui-card-border' as any]: '1px solid #e2e8f0',
  ['--a2ui-card-box-shadow' as any]:
    '0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
  ['--a2ui-card-padding' as any]: '18px 22px',
  ['--a2ui-card-margin' as any]: '8px 0',

  // Primitives & General
  ['--a2ui-border-radius' as any]: '12px',
  ['--a2ui-color-border' as any]: '#e2e8f0',
  ['--a2ui-color-surface' as any]: '#ffffff',
  ['--a2ui-color-on-surface' as any]: '#0f172a',

  // Primary Action & Button
  ['--a2ui-color-primary' as any]: '#2563eb',
  ['--a2ui-color-primary-hover' as any]: '#1d4ed8',
  ['--a2ui-color-on-primary' as any]: '#ffffff',
  ['--a2ui-button-border-radius' as any]: '10px',
  ['--a2ui-button-background' as any]: '#2563eb',
  ['--a2ui-button-padding' as any]: '8px 18px',
  ['--a2ui-button-font-weight' as any]: '600',
  ['--a2ui-button-box-shadow' as any]: '0 1px 2px rgba(37, 99, 235, 0.2)',

  // Spacing & Icons
  ['--a2ui-spacing-s' as any]: '6px',
  ['--a2ui-spacing-m' as any]: '12px',
  ['--a2ui-spacing-l' as any]: '20px',
  ['--a2ui-icon-size' as any]: '22px',
  ['--a2ui-icon-color' as any]: '#2563eb',

  // Typography & Dividers
  ['--a2ui-divider-color' as any]: '#f1f5f9',
  ['--a2ui-text-caption-color' as any]: '#64748b',
};
