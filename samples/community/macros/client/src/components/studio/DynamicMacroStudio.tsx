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

interface DynamicMacroStudioProps {
  selectedTemplate: MacroDefinition;
  libraryProcessor: MessageProcessor<any>;
  dynamicTab: 'input' | 'layout' | 'resolved';
  setDynamicTab: (tab: 'input' | 'layout' | 'resolved') => void;
  payrollDept: string;
  setPayrollDept: (dept: string) => void;
  payrollIncludeBonus: boolean;
  setPayrollIncludeBonus: (bonus: boolean) => void;
  selectedDynamicEmpId: string;
  dynamicResolvedData: Record<string, any> | null;
  dynamicResolving: boolean;
  handleResolveDynamicTemplate: (paramInput?: any) => Promise<void>;
}

export function DynamicMacroStudio({
  selectedTemplate,
  libraryProcessor,
  dynamicTab,
  setDynamicTab,
  payrollDept,
  setPayrollDept,
  payrollIncludeBonus,
  setPayrollIncludeBonus,
  selectedDynamicEmpId,
  dynamicResolvedData,
  dynamicResolving,
  handleResolveDynamicTemplate,
}: DynamicMacroStudioProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px',
        gap: '20px',
        overflowY: 'auto',
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <h2 style={{fontSize: '18px', fontWeight: 800, margin: 0, color: '#0f172a'}}>
              {selectedTemplate.templateId}
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
                backgroundColor: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
              }}
            >
              ⚡ Dynamic Server Resolver
            </span>
          </div>
          <p style={{fontSize: '13px', color: '#64748b', margin: 0, maxWidth: '700px'}}>
            {selectedTemplate.description}
          </p>
        </div>

        {/* Stage Switcher */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            padding: '3px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
          }}
        >
          {[
            {id: 'input', label: '1. Input Interface'},
            {
              id: 'layout',
              label: '2. Python Macro Function',
            },
            {id: 'resolved', label: '3. Resolved Output'},
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setDynamicTab(tab.id as any)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: dynamicTab === tab.id ? '#ffffff' : 'transparent',
                color: dynamicTab === tab.id ? '#2563eb' : '#64748b',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                boxShadow: dynamicTab === tab.id ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Stage Body */}
      <div style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', flex: 1}}>
        {/* Left Column: Interactive Stages */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          {dynamicTab === 'input' && (
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    margin: '0 0 4px',
                    color: '#0f172a',
                  }}
                >
                  Step 1: Simple LLM Input Interface
                </h3>
                <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                  The LLM generates only simple identifiers. Confidential figures are never exposed
                  in prompt context.
                </p>
              </div>

              {/* Input Selector Form */}
              {selectedTemplate.templateId === 'PayrollSummary' ? (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div>
                    <label
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#334155',
                        display: 'block',
                        marginBottom: '6px',
                      }}
                    >
                      Department Name (`department`):
                    </label>
                    <input
                      type="text"
                      value={payrollDept}
                      onChange={e => {
                        setPayrollDept(e.target.value);
                        handleResolveDynamicTemplate({department: e.target.value});
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        fontSize: '13px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={payrollIncludeBonus}
                      onChange={e => {
                        setPayrollIncludeBonus(e.target.checked);
                        handleResolveDynamicTemplate({includeBonus: e.target.checked});
                      }}
                    />
                    Include Annual Bonus Column (`includeBonus`)
                  </label>

                  <div style={{marginTop: '8px'}}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#64748b',
                        marginBottom: '4px',
                      }}
                    >
                      Generated Express DSL by LLM:
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px 14px',
                        backgroundColor: '#0f172a',
                        color: '#38bdf8',
                        borderRadius: '8px',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                      }}
                    >
                      {`<a2ui>\nroot = PayrollSummary("${payrollDept}", ${payrollIncludeBonus})\n</a2ui>`}
                    </pre>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <label style={{fontSize: '12px', fontWeight: 700, color: '#334155'}}>
                    Select Employee (Input Parameter `employeeId`):
                  </label>
                  <select
                    value={selectedDynamicEmpId}
                    onChange={e => handleResolveDynamicTemplate(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#0f172a',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {(
                      selectedTemplate.availablePresets || [
                        {label: 'Dr. Elena Vance (emp_101)', value: 'emp_101'},
                        {label: 'Marcus Vance (emp_102)', value: 'emp_102'},
                        {label: 'Aria Chen (emp_103)', value: 'emp_103'},
                        {label: 'Liam Kjell (emp_104)', value: 'emp_104'},
                      ]
                    ).map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <div style={{marginTop: '8px'}}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#64748b',
                        marginBottom: '4px',
                      }}
                    >
                      Generated Express DSL by LLM:
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px 14px',
                        backgroundColor: '#0f172a',
                        color: '#38bdf8',
                        borderRadius: '8px',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                      }}
                    >
                      {`<a2ui>\nroot = EmployeeSalaryCard("${selectedDynamicEmpId}")\n</a2ui>`}
                    </pre>
                  </div>
                </div>
              )}

              <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                <button
                  onClick={() => handleResolveDynamicTemplate()}
                  disabled={dynamicResolving}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: dynamicResolving ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span className="material-symbols-outlined" style={{fontSize: '16px'}}>
                    sync
                  </span>
                  <span>
                    {dynamicResolving
                      ? 'Computing...'
                      : selectedTemplate.isProgrammatic
                        ? 'Run Python Render Function'
                        : 'Execute Server Resolver'}
                  </span>
                </button>
                <span style={{fontSize: '12px', color: '#059669', fontWeight: 600}}>
                  {selectedTemplate.isProgrammatic
                    ? '✓ Python execution engine active'
                    : '✓ Server resolver connected'}
                </span>
              </div>
            </div>
          )}

          {dynamicTab === 'layout' && (
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    margin: '0 0 4px',
                    color: '#0f172a',
                  }}
                >
                  Step 2: Python Macro Function (Typesafe Component Builder)
                </h3>
                <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                  {selectedTemplate.isProgrammatic
                    ? 'This macro is generated directly by a Python render function using loops, conditionals, and math to construct the component AST.'
                    : 'The visual layout is constructed programmatically using pure Python functions and typesafe catalog builders. Sensitive parameters are resolved server-side.'}
                </p>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: '16px',
                  backgroundColor: '#0f172a',
                  color: '#f8fafc',
                  borderRadius: '12px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  maxHeight: '440px',
                  overflowY: 'auto',
                  whiteSpace: 'pre',
                }}
              >
                {selectedTemplate.renderSource ||
                  selectedTemplate.layoutTemplatePython ||
                  selectedTemplate.layoutTemplateYaml ||
                  selectedTemplate.pythonCode ||
                  '# Python macro function'}
              </pre>
            </div>
          )}

          {dynamicTab === 'resolved' && (
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    margin: '0 0 4px',
                    color: '#0f172a',
                  }}
                >
                  Step 3: Server-Resolved Injected Data
                </h3>
                <p style={{fontSize: '13px', color: '#64748b', margin: 0}}>
                  Live record retrieved from the internal HR database for {selectedDynamicEmpId}.
                </p>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: '16px',
                  backgroundColor: '#0f172a',
                  color: '#a5f3fc',
                  borderRadius: '12px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                }}
              >
                {JSON.stringify(dynamicResolvedData || {}, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Right Column: Live Inflated Preview */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h3 style={{fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a'}}>
              Inflated Output Preview
            </h3>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: '6px',
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
              boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.06)',
              minHeight: '280px',
              ...A2UI_THEME_VARS,
            }}
          >
            {(() => {
              const dynSurface =
                libraryProcessor.model.getSurface(
                  `preview_${selectedTemplate.templateId}_${selectedDynamicEmpId}`,
                ) || libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`);
              return dynSurface ? (
                <A2uiSurface surface={dynSurface} />
              ) : (
                <div style={{color: '#94a3b8', textAlign: 'center', padding: '40px'}}>
                  No preview surface available for this template.
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
