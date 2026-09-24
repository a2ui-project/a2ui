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

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {FunctionDeclaration, Type} from '@google/genai';

/** Resolves the package root directory across both tsx and compiled dist/src. */
export function getPackageRootDir(): string {
  const dirname = fileURLToPath(new URL('.', import.meta.url));
  if (fs.existsSync(path.join(dirname, '../package.json'))) {
    return path.resolve(dirname, '..');
  }
  return path.resolve(dirname, '../..');
}

/** Resolves the Python ADK restaurant finder sample directory. */
export function resolvePythonSampleDir(): string {
  const root = getPackageRootDir();
  return path.resolve(root, '../../adk/restaurant_finder');
}

/** Verifies that the shared Python assets exist at startup. */
export function verifyPythonSampleAssets(pythonDir: string = resolvePythonSampleDir()): void {
  const dataPath = path.join(pythonDir, 'restaurant_data.json');
  const imagesDir = path.join(pythonDir, 'images');

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `Required restaurant data file not found at ${dataPath}. ` +
        'Please ensure the Python ADK sample is present.',
    );
  }
  if (!fs.existsSync(imagesDir)) {
    throw new Error(
      `Required images directory not found at ${imagesDir}. ` +
        'Please ensure the Python ADK sample is present.',
    );
  }
}

export const getRestaurantsDeclaration: FunctionDeclaration = {
  name: 'get_restaurants',
  description:
    "Call this tool to get a list of restaurants based on a cuisine and location. 'count' is the number of restaurants to return.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      cuisine: {
        type: Type.STRING,
        description: 'The cuisine type to search for.',
      },
      location: {
        type: Type.STRING,
        description: 'The location to search in.',
      },
      count: {
        type: Type.INTEGER,
        description: 'The number of restaurants to return.',
      },
    },
    required: ['cuisine', 'location'],
  },
};

export interface GetRestaurantsArgs {
  cuisine?: string;
  location?: string;
  count?: number;
}

/**
 * Executes the get_restaurants tool, mirroring Python tools.py.
 */
export function executeGetRestaurants(
  args: GetRestaurantsArgs,
  baseUrl: string,
  pythonDir: string = resolvePythonSampleDir(),
): string {
  const cuisine = args.cuisine ?? '';
  const location = args.location ?? '';
  const count = typeof args.count === 'number' ? args.count : 5;

  console.log(`--- TOOL CALLED: get_restaurants (count: ${count}) ---`);
  console.log(`  - Cuisine: ${cuisine}`);
  console.log(`  - Location: ${location}`);

  let items: unknown[] = [];
  const locLower = location.toLowerCase();
  if (locLower.includes('new york') || locLower.includes('ny')) {
    const filePath = path.join(pythonDir, 'restaurant_data.json');
    try {
      let restaurantDataStr = fs.readFileSync(filePath, 'utf-8');
      if (baseUrl) {
        restaurantDataStr = restaurantDataStr.replaceAll('http://localhost:10002', baseUrl);
        console.log(`Updated base URL from tool context: ${baseUrl}`);
      }
      const allItems = JSON.parse(restaurantDataStr) as unknown[];
      items = allItems.slice(0, count);
      console.log(`  - Success: Found ${allItems.length} restaurants, returning ${items.length}.`);
    } catch (e) {
      console.error(`  - Error reading/parsing restaurant_data.json: ${e}`);
    }
  }

  return JSON.stringify(items);
}
