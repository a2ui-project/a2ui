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

'use client';

import {useState} from 'react';
import {cn} from '@/lib/utils';
import {ExternalLink, Copy, Check} from 'lucide-react';
import {A2UIViewer} from '@/lib/a2ui';
import {MATERIAL_ICONS} from '@/lib/components-data-v09';
import {useSpecVersion} from '@/contexts/spec-version-context';
import type {A2UIComponent, SpecVersion} from '@/types/widget';

function iconComponent(name: string): A2UIComponent[] {
  return [{id: 'icon', component: 'Icon', name}];
}

function IconCard({
  name,
  isSelected,
  onClick,
  specVersion,
}: {
  name: string;
  isSelected: boolean;
  onClick: () => void;
  specVersion: SpecVersion;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors',
        isSelected
          ? 'border-foreground bg-muted'
          : 'border-border bg-white hover:border-muted-foreground/30',
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center scale-[2]">
        <A2UIViewer root="icon" components={iconComponent(name)} specVersion={specVersion} />
      </div>
      <span className="text-xs text-muted-foreground truncate w-full text-center">{name}</span>
    </button>
  );
}

export default function IconsPage() {
  const {specVersion} = useSpecVersion();
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (name: string) => {
    const code = `{ "id": "icon", "component": "Icon", "name": "${name}" }`;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Icons</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A2UI uses Material Icons. Showing {MATERIAL_ICONS.length} supported icons.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {selectedIcon && (
            <button
              onClick={() => handleCopy(selectedIcon)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy &quot;{selectedIcon}&quot;
                </>
              )}
            </button>
          )}
          <a
            href="https://fonts.google.com/icons"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Browse all icons
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
        {MATERIAL_ICONS.map(name => (
          <IconCard
            key={name}
            name={name}
            isSelected={selectedIcon === name}
            onClick={() => setSelectedIcon(name)}
            specVersion={specVersion}
          />
        ))}
      </div>
    </div>
  );
}
