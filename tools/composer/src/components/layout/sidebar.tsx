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
import {Menu} from 'lucide-react';
import {cn} from '@/lib/utils';
import {SidebarHeader} from './sidebar-header';
import {SidebarNav} from './sidebar-nav';
import {VersionSelector} from './version-selector';
import {SidebarWidgets} from './sidebar-widgets';
import {Button} from '@/components/ui/button';

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle button */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-4 top-4 z-50 md:hidden cursor-pointer"
          onClick={() => setIsOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed z-40 flex h-full w-[220px] flex-col gap-4 border-2 border-white bg-white/50 p-3 transition-transform md:relative md:translate-x-0 rounded-lg',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarHeader />
        <hr />
        <VersionSelector />
        <hr />
        <SidebarNav onNavigate={() => setIsOpen(false)} />
        <hr />
        <SidebarWidgets onNavigate={() => setIsOpen(false)} />
      </aside>
    </>
  );
}
