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

import React from 'react';
import {type ComponentContext, type ComponentId} from '@a2ui/web_core/v0_9';

type ResolvedChildRef =
  | ComponentId
  | {
      id: ComponentId;
      basePath: string;
    };

type ResolvedChildList = ResolvedChildRef[];

export const ChildList: React.FC<{
  childList: ResolvedChildList;
  context: ComponentContext;
  buildChild: (id: ComponentId, basePath?: string) => React.ReactNode;
}> = ({childList, buildChild}) => {
  if (!Array.isArray(childList)) return null;

  return (
    <>
      {childList.map((childRef, index) => {
        if (typeof childRef === 'string') {
          return (
            <React.Fragment key={`${childRef}-${index}`}>{buildChild(childRef)}</React.Fragment>
          );
        }

        return (
          <React.Fragment key={`${childRef.id}-${childRef.basePath}`}>
            {buildChild(childRef.id, childRef.basePath)}
          </React.Fragment>
        );
      })}
    </>
  );
};
