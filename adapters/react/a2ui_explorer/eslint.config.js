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

import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import gts from 'gts';

export default tseslint.config(
  // Google TypeScript style guide plugin.
  ...gts.map(config => ({
    ...config,
    // Override the project for a2ui_explorer since it has its own tsconfig
    ...(config.languageOptions?.parserOptions?.project
      ? {
          languageOptions: {
            ...config.languageOptions,
            parserOptions: {
              ...config.languageOptions.parserOptions,
              project: ['./tsconfig.app.json', './tsconfig.node.json'],
            },
          },
        }
      : {}),
  })),

  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // React Hooks rules (errors)
      ...reactHooksPlugin.configs.recommended.rules,

      // React Refresh rules
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      // General rules
      'no-console': ['warn', {allow: ['warn', 'error']}],
      'prefer-arrow-callback': 'off',
    },
  },

  // Test files - relaxed rules
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'src/setupTests.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Prettier config
  prettierConfig,

  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'],
  },
);
