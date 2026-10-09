// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// Whether a v1.0 function call nested in a component runs in the
/// component's catalog, the one with [catalogId].
///
/// A call runs in the catalog it names, or else in the surface's default
/// catalog. So a call that names no `catalogId` runs in the component's
/// catalog only when that catalog is the surface default. An empty
/// `catalogId` names a catalog too.
///
/// [callCatalogId] is the `catalogId` the call names, or null, and
/// [catalogIsDefault] whether the component's catalog is the surface's
/// default catalog.
///
/// `PayloadValidator` fully checks a nested call when this holds, and
/// `MessageProcessor` checks the other calls against the catalog they
/// resolve to.
bool nestedCallRunsInCatalog(
  Object? callCatalogId,
  String catalogId, {
  required bool catalogIsDefault,
}) {
  if (callCatalogId == null) return catalogIsDefault;
  return callCatalogId == catalogId;
}
