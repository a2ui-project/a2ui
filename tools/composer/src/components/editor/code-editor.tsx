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

import Editor, {type Monaco} from '@monaco-editor/react';

interface CodeEditorProps {
  value: string;
  onChange?: (code: string) => void;
}

export function CodeEditor({value, onChange}: CodeEditorProps) {
  const handleBeforeMount = (monaco: Monaco) => {
    // Disable all TypeScript/JavaScript diagnostics
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });

    // Define custom theme with background line highlight instead of border
    monaco.editor.defineTheme('custom-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.lineHighlightBackground': '#f5f5f5',
        'editor.lineHighlightBorder': '#00000000', // transparent
      },
    });
  };

  return (
    <div className="h-full w-full">
      <Editor
        value={value}
        defaultLanguage="json"
        theme="custom-light"
        onChange={value => onChange?.(value ?? '')}
        beforeMount={handleBeforeMount}
        options={{
          minimap: {enabled: false},
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          padding: {top: 16, bottom: 16},
          cursorStyle: 'line',
          renderLineHighlight: 'all',
          renderLineHighlightOnlyWhenFocus: false,
          guides: {
            indentation: false,
            bracketPairs: false,
            highlightActiveIndentation: false,
          },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'hidden',
          },
        }}
      />
    </div>
  );
}
