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

import {useState, useEffect} from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import {MacroDefinition} from '../types';
import {A2UI_THEME_VARS} from '../theme';

export function MacroStudioView() {
  const [libraryProcessor] = useState(() => new MessageProcessor([basicCatalog]));
  const [, setLibraryTick] = useState(0);
  const [templates, setTemplates] = useState<MacroDefinition[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('UserProfile');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  // Dynamic Template Interactive State
  const [selectedDynamicEmpId, setSelectedDynamicEmpId] = useState<string>('emp_101');
  const [payrollDept, setPayrollDept] = useState<string>('Global Engineering');
  const [payrollIncludeBonus, setPayrollIncludeBonus] = useState<boolean>(true);
  const [dynamicResolvedData, setDynamicResolvedData] = useState<Record<string, any> | null>(null);
  const [dynamicTab, setDynamicTab] = useState<'input' | 'layout' | 'resolved'>('input');
  const [dynamicResolving, setDynamicResolving] = useState(false);

  useEffect(() => {
    const forceUpdate = () => setLibraryTick(t => t + 1);
    const subCreated = libraryProcessor.onSurfaceCreated(forceUpdate);
    const subDeleted = libraryProcessor.onSurfaceDeleted(forceUpdate);
    return () => {
      subCreated.unsubscribe();
      subDeleted.unsubscribe();
    };
  }, [libraryProcessor]);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLibraryLoading(true);
      try {
        const res = await fetch('http://127.0.0.1:8000/macros');
        if (res.ok) {
          const list: MacroDefinition[] = await res.json();
          setTemplates(list);
          if (list.length > 0) {
            setSelectedTemplateId(prev =>
              list.find(t => t.templateId === prev) ? prev : list[0].templateId,
            );
            const safeProcessMessages = (msgs: any[]) => {
              for (const m of msgs) {
                if (m.createSurface) {
                  const sId = m.createSurface.surfaceId;
                  if (libraryProcessor.model.getSurface(sId)) {
                    libraryProcessor.processMessages([
                      {version: 'v0.9.1', deleteSurface: {surfaceId: sId}},
                    ]);
                  }
                }
              }
              libraryProcessor.processMessages(msgs);
            };

            for (const item of list) {
              if (item.sampleMessages && item.sampleMessages.length > 0) {
                safeProcessMessages(item.sampleMessages);
                if (item.isDynamic) {
                  const empId = item.sampleData?.employeeId || 'emp_101';
                  const dynamicSurfaceId = `preview_${item.templateId}_${empId}`;
                  const dynamicMsgs = item.sampleMessages.map((m: any) => {
                    if (m.createSurface) {
                      return {
                        ...m,
                        createSurface: {
                          ...m.createSurface,
                          surfaceId: dynamicSurfaceId,
                        },
                      };
                    }
                    if (m.updateComponents) {
                      return {
                        ...m,
                        updateComponents: {
                          ...m.updateComponents,
                          surfaceId: dynamicSurfaceId,
                        },
                      };
                    }
                    return m;
                  });
                  safeProcessMessages(dynamicMsgs);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load templates list:', e);
      } finally {
        setLibraryLoading(false);
      }
    };
    fetchTemplates();
  }, [libraryProcessor]);

  const selectedTemplate = templates.find(t => t.templateId === selectedTemplateId);

  useEffect(() => {
    if (selectedTemplate?.isDynamic) {
      if (selectedTemplate.resolvedData) {
        setDynamicResolvedData(selectedTemplate.resolvedData);
      }
      if (selectedTemplate.sampleData?.employeeId) {
        setSelectedDynamicEmpId(selectedTemplate.sampleData.employeeId);
      }
      if (selectedTemplate.sampleData?.department) {
        setPayrollDept(selectedTemplate.sampleData.department);
      }
      if (selectedTemplate.sampleData?.includeBonus !== undefined) {
        setPayrollIncludeBonus(selectedTemplate.sampleData.includeBonus);
      }
    }
  }, [selectedTemplate]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleResolveDynamicTemplate = async (paramInput?: any) => {
    if (!selectedTemplate) return;
    setDynamicResolving(true);
    let sendParams: Record<string, any> = {};
    let surfaceSuffix = 'default';

    if (selectedTemplate.templateId === 'PayrollSummary') {
      const dept =
        paramInput && typeof paramInput === 'object' && paramInput.department !== undefined
          ? paramInput.department
          : payrollDept;
      const bonus =
        paramInput && typeof paramInput === 'object' && paramInput.includeBonus !== undefined
          ? paramInput.includeBonus
          : payrollIncludeBonus;
      sendParams = {department: dept, includeBonus: bonus};
      surfaceSuffix = `${dept.replace(/\s+/g, '_')}_${bonus}`;
    } else {
      const empId = typeof paramInput === 'string' ? paramInput : selectedDynamicEmpId;
      setSelectedDynamicEmpId(empId);
      sendParams = {employeeId: empId};
      surfaceSuffix = empId;
    }

    try {
      const res = await fetch(
        `http://127.0.0.1:8000/macros/${selectedTemplate.templateId}/resolve`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({params: sendParams}),
        },
      );
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      const data = await res.json();
      setDynamicResolvedData(data.resolvedData);
      if (data.sampleMessages) {
        const dynamicSurfaceId = `preview_${selectedTemplate.templateId}_${surfaceSuffix}`;
        const updatedMessages = data.sampleMessages.map((m: any) => {
          if (m.createSurface) {
            return {
              ...m,
              createSurface: {
                ...m.createSurface,
                surfaceId: dynamicSurfaceId,
              },
            };
          }
          if (m.updateComponents) {
            return {
              ...m,
              updateComponents: {
                ...m.updateComponents,
                surfaceId: dynamicSurfaceId,
              },
            };
          }
          return m;
        });
        if (libraryProcessor.model.getSurface(dynamicSurfaceId)) {
          libraryProcessor.processMessages([
            {version: 'v0.9.1', deleteSurface: {surfaceId: dynamicSurfaceId}},
          ]);
        }
        libraryProcessor.processMessages(updatedMessages);
        setLibraryTick(t => t + 1);
      }
    } catch (err) {
      console.error('Failed to resolve dynamic template:', err);
    } finally {
      setDynamicResolving(false);
    }
  };

  return (
    <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
      {/* Library Sidebar List */}
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
              onClick={() => setSelectedTemplateId(tmpl.templateId)}
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

      {/* Studio Content */}
      {selectedTemplate ? (
        selectedTemplate.isDynamic ? (
          /* Dynamic Template 3-Stage Inspector Studio */
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
                        The LLM generates only simple identifiers. Confidential figures are never
                        exposed in prompt context.
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
                        Live record retrieved from the internal HR database for{' '}
                        {selectedDynamicEmpId}.
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
                      ) ||
                      libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`);
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
        ) : (
          /* Standard Static Template Studio */
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
                    surface={
                      libraryProcessor.model.getSurface(`preview_${selectedTemplate.templateId}`)!
                    }
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
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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
                    copyToClipboard(
                      selectedTemplate.pythonCode || selectedTemplate.yamlContent || '',
                    );
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
                    const codeText =
                      selectedTemplate.pythonCode || selectedTemplate.yamlContent || '';
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
        )
      ) : (
        <div style={{margin: 'auto', color: '#64748b'}}>
          {libraryLoading ? 'Loading templates...' : 'No templates available.'}
        </div>
      )}
    </div>
  );
}
