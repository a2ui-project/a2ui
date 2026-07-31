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

'use client';

import {useState} from 'react';
import {Copy, Check, Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Widget} from '@/types/widget';

interface EditorHeaderProps {
  widget: Widget;
}

export function EditorHeader({widget}: EditorHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyJson = async () => {
    const json = JSON.stringify(widget.components, null, 2);
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const json = JSON.stringify(widget.components, null, 2);
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `a2ui-${widget.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-14 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium">{widget.name}</h1>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          v{widget.specVersion}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground cursor-pointer"
          onClick={handleCopyJson}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied!' : 'Copy JSON'}
        </Button>
        <Button
          size="sm"
          className="gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
          onClick={handleDownload}
        >
          <Download className="h-4 w-4" />
          Download
        </Button>
      </div>
    </div>
  );
}
