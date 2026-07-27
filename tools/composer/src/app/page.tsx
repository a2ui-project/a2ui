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

import {Metadata} from 'next';
import {CreateWidget} from '@/components/main/create-widget';

export const metadata: Metadata = {
  title: 'Create | A2UI Composer',
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-32">
      <CreateWidget />
    </div>
  );
}
