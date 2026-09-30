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
import {basicCatalog} from '@a2ui/react/v0_9';
import {MacroDefinition} from '../types';
import {API_BASE_URL} from '../config';
import {MacroStudioSidebar} from './studio/MacroStudioSidebar';
import {DynamicMacroStudio} from './studio/DynamicMacroStudio';
import {StaticMacroStudio} from './studio/StaticMacroStudio';

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
        const res = await fetch(`${API_BASE_URL}/macros`);
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
      const res = await fetch(`${API_BASE_URL}/macros/${selectedTemplate.templateId}/resolve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({params: sendParams}),
      });
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
      <MacroStudioSidebar
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={setSelectedTemplateId}
      />

      {selectedTemplate ? (
        selectedTemplate.isDynamic ? (
          <DynamicMacroStudio
            selectedTemplate={selectedTemplate}
            libraryProcessor={libraryProcessor}
            dynamicTab={dynamicTab}
            setDynamicTab={setDynamicTab}
            payrollDept={payrollDept}
            setPayrollDept={setPayrollDept}
            payrollIncludeBonus={payrollIncludeBonus}
            setPayrollIncludeBonus={setPayrollIncludeBonus}
            selectedDynamicEmpId={selectedDynamicEmpId}
            dynamicResolvedData={dynamicResolvedData}
            dynamicResolving={dynamicResolving}
            handleResolveDynamicTemplate={handleResolveDynamicTemplate}
          />
        ) : (
          <StaticMacroStudio
            selectedTemplate={selectedTemplate}
            libraryProcessor={libraryProcessor}
            copiedTemplate={copiedTemplate}
            onCopyTemplate={copyToClipboard}
          />
        )
      ) : (
        <div style={{margin: 'auto', color: '#64748b'}}>
          {libraryLoading ? 'Loading templates...' : 'No templates available.'}
        </div>
      )}
    </div>
  );
}
