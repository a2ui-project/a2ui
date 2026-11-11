/*
 * Copyright 2026 Google LLC
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
 * Stands in for a ReactApp while the model is still writing its source: a card shaped like a
 * small chart, so the page doesn't jump when the app arrives.
 */
export function AppSkeleton({title, height}: {title: string | null; height: number | null}) {
  const bodyHeight = Math.min(Math.max(height ?? 300, 180), 520);
  return (
    <div className="app-skeleton" data-testid="app-skeleton" aria-busy="true">
      <div className="app-skeleton-head">
        <span className="app-skeleton-title">{title ?? 'Interactive app'}</span>
        <span className="app-skeleton-status">
          writing app
          <span className="dots" aria-hidden="true" />
        </span>
      </div>
      <div className="app-skeleton-body" style={{height: bodyHeight - 56}}>
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
