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

/**
 * Stands in for a ReactApp while the model is still writing its source: a placeholder
 * that blends seamlessly with surrounding A2UI content.
 */
export function AppSkeleton({
  title,
  height,
  embedded,
}: {
  title: string | null;
  height: number | null;
  embedded?: boolean;
}) {
  const bodyHeight = Math.min(Math.max(height ?? 260, 160), 480);
  const displayTitle = title && title !== 'Interactive app' ? title : null;

  return (
    <div
      className={`app-skeleton${embedded ? ' app-skeleton-embedded' : ''}`}
      data-testid="app-skeleton"
      aria-busy="true"
    >
      <div className="app-skeleton-head">
        {displayTitle && <span className="app-skeleton-title">{displayTitle}</span>}
        <span className="app-skeleton-status">
          custom component loading
          <span className="dots" aria-hidden="true" />
        </span>
      </div>
      <div className="app-skeleton-body" style={{height: bodyHeight - 48}}>
        {[62, 48, 74, 40, 86, 55, 68, 36].map((bar, index) => (
          <span
            key={index}
            className="app-skeleton-bar"
            style={{height: `${bar}%`, animationDelay: `${index * 90}ms`}}
          />
        ))}
      </div>
    </div>
  );
}
