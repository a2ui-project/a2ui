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

import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface} from '@a2ui/react/v0_9';
import {MacroDefinition} from '../../types';
import {A2UI_THEME_VARS} from '../../theme';

interface StaticMacroStudioProps {
  selectedTemplate: MacroDefinition;
  libraryProcessor: MessageProcessor<any>;
  copiedTemplate: boolean;
  onCopyTemplate: (code: string) => void;
}

export function StaticMacroStudio({
  selectedTemplate,
  libraryProcessor,
  copiedTemplate,
  onCopyTemplate,
}: StaticMacroStudioProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px',
        padding: '24px',
        overflowY: 'auto',
      }}
    >
      {/* Left: Live Inflated Preview */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div>
            <h3 style={{fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
              Inflated UI Preview
            </h3>
            <p style={{fontSize: '12px', color: '#64748b', margin: '2px 0 0'}}>
              Rendered via @a2ui/react using declared sampleData
            </p>
          </div>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '8px',
              backgroundColor: '#ecfdf5',
              color: '#047857',
              border: '1px solid #a7f3d0',
            }}
          >
            ✓ Live Inflated
          </span>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '18px',
            border: '1px solid #e2e8f0',
            padding: '24px',
            boxShadow:
              '0 4px 20px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
            minHeight: '280px',
            ...A2UI_THEME_VARS,
          }}
        >
          {libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`) ? (
            <A2uiSurface
              surface={libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`)!}
            />
          ) : (
            <div style={{color: '#94a3b8', textAlign: 'center', padding: '40px'}}>
              No preview surface available for this template.
            </div>
          )}
        </div>

        {selectedTemplate.sampleData && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '16px',
            }}
          >
            <h4
              style={{
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#64748b',
                letterSpacing: '0.05em',
                margin: '0 0 8px',
              }}
            >
              Sample Data Inputs
            </h4>
            <pre
              style={{
                margin: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '12px',
                color: '#0f172a',
                backgroundColor: '#f8fafc',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(selectedTemplate.sampleData, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Right: Code with Line Numbers & Monospace Font */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div>
            <h3 style={{fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
              Macro Definition (Python)
            </h3>
            <p style={{fontSize: '12px', color: '#64748b', margin: '2px 0 0'}}>
              Pure Python @macro function using typesafe catalog builders
            </p>
          </div>

          <button
            onClick={() => {
              onCopyTemplate(selectedTemplate.pythonCode || selectedTemplate.yamlContent || '');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize: '15px'}}>
              {copiedTemplate ? 'check' : 'content_copy'}
            </span>
            <span>{copiedTemplate ? 'Copied Python!' : 'Copy Macro Code'}</span>
          </button>
        </div>

        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '16px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '620px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              backgroundColor: '#1e293b',
              borderBottom: '1px solid #334155',
              fontSize: '11px',
              color: '#94a3b8',
            }}
          >
            <span style={{fontFamily: 'monospace', color: '#38bdf8'}}>
              {selectedTemplate.name || selectedTemplate.templateId}.py
            </span>
            <span>Python 3.10+ · @macro</span>
          </div>

          <div
            style={{
              display: 'flex',
              overflowY: 'auto',
              padding: '16px 0',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '12px',
              lineHeight: '20px',
            }}
          >
            {(() => {
              const codeText = selectedTemplate.pythonCode || selectedTemplate.yamlContent || '';
              const lines = codeText.split('\n');

              return (
                <>
                  <div
                    style={{
                      padding: '0 12px 0 16px',
                      textAlign: 'right',
                      color: '#475569',
                      userSelect: 'none',
                      borderRight: '1px solid #1e293b',
                    }}
                  >
                    {lines.map((_, idx) => (
                      <div key={idx}>{idx + 1}</div>
                    ))}
                  </div>

                  <div
                    style={{
                      padding: '0 16px',
                      color: '#e2e8f0',
                      flex: 1,
                      whiteSpace: 'pre',
                      overflowX: 'auto',
                    }}
                  >
                    {lines.map((line, idx) => (
                      <div key={idx}>{line || ' '}</div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
