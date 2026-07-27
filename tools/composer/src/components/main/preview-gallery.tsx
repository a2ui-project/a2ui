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

const suggestions = [
  {icon: 'person', label: 'Profile card'},
  {icon: 'thermostat', label: 'Weather widget'},
  {icon: 'task_alt', label: 'Todo list'},
  {icon: 'music_note', label: 'Music player'},
];

interface PreviewGalleryProps {
  onSelect?: (label: string) => void;
}

export function PreviewGallery({onSelect}: PreviewGalleryProps) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {suggestions.map(s => (
        <button
          key={s.label}
          onClick={() => onSelect?.(s.label)}
          className="flex items-center gap-2 rounded-full border border-white/80 bg-white/50 px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-white/70 hover:text-foreground cursor-pointer"
        >
          <span className="material-symbols-rounded text-lg">{s.icon}</span>
          {s.label}
        </button>
      ))}
    </div>
  );
}
