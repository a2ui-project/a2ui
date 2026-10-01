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

import {MacroDefinition} from '../../types';

interface MacroStudioSidebarProps {
  templates: MacroDefinition[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
}

export function MacroStudioSidebar({
  templates,
  selectedTemplateId,
  onSelectTemplate,
}: MacroStudioSidebarProps) {
  return (
    <div
      style={{
        width: '320px',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        overflowY: 'auto',
      }}
    >
      <div style={{padding: '0 8px 12px 8px'}}>
        <h2 style={{fontSize: '15px', fontWeight: 700, margin: '0 0 4px', color: '#0f172a'}}>
          Registered Macros
        </h2>
        <p style={{fontSize: '12px', color: '#64748b', margin: 0}}>
          Inspect programmatic macros and dynamic server resolvers.
        </p>
      </div>

      {templates.map(tmpl => {
        const isSelected = tmpl.templateId === selectedTemplateId;
        const paramCount = Object.keys(tmpl.parameters || {}).length;
        const compCount = (tmpl.components || []).length;

        return (
          <button
            key={tmpl.templateId}
            onClick={() => onSelectTemplate(tmpl.templateId)}
            style={{
              textAlign: 'left',
              padding: '12px 14px',
              borderRadius: '12px',
              border: isSelected ? '1px solid #93c5fd' : '1px solid #e2e8f0',
              backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  color: isSelected ? '#1d4ed8' : '#0f172a',
                }}
              >
                {tmpl.templateId}
              </span>
              {tmpl.isDynamic ? (
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    backgroundColor: '#fef3c7',
                    color: '#b45309',
                    fontWeight: 700,
                    border: '1px solid #fde68a',
                  }}
                >
                  ⚡ Dynamic
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: isSelected ? '#dbeafe' : '#f1f5f9',
                    color: isSelected ? '#1e40af' : '#64748b',
                    fontWeight: 600,
                  }}
                >
                  {paramCount} params
                </span>
              )}
            </div>
            <span style={{fontSize: '11px', color: '#64748b'}}>
              {tmpl.isDynamic
                ? 'Server database resolver callback'
                : `${compCount} primitive components`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
