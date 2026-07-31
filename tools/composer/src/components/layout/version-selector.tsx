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

/**
 * Global A2UI spec version selector.
 *
 * Displayed in the sidebar. Controls which version the entire
 * composer uses for rendering, gallery, and widget creation.
 */
'use client';

import {useSpecVersion} from '@/contexts/spec-version-context';
import type {SpecVersion} from '@/types/widget';

const VERSIONS: {value: SpecVersion; label: string}[] = [
  {value: '0.8', label: 'v0.8'},
  {value: '0.9', label: 'v0.9'},
];

export function VersionSelector() {
  const {specVersion, setSpecVersion} = useSpecVersion();

  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="text-xs font-medium text-muted-foreground">Spec</span>
      <div className="flex flex-1 rounded-md bg-white/50 p-0.5">
        {VERSIONS.map(({value, label}) => (
          <button
            key={value}
            onClick={() => setSpecVersion(value)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
              specVersion === value
                ? 'bg-white text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
