// Copyright 2026 Google LLC
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

import A2UICore
import A2UIJSON
import Foundation
import JSONSchema
import OrderedJSON
import Testing

struct SurfaceGroupModelTests {

  @Test func addSurfacePublishesToSurfacesMap() throws {
    let group = SurfaceGroupModel()
    let catalog = try makeTestCatalog()
    let vm = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    group.addSurface(vm)
    #expect(group.surfaces["s1"] != nil)
    #expect(group.surfaces.count == 1)
  }

  @Test func addDuplicateSurfaceIsIgnored() throws {
    let group = SurfaceGroupModel()
    let catalog = try makeTestCatalog()
    let vm1 = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    let vm2 = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    group.addSurface(vm1)
    group.addSurface(vm2)
    #expect(group.surfaces.count == 1)
  }

  @Test func removeSurfaceRemovesFromGroup() throws {
    let group = SurfaceGroupModel()
    let catalog = try makeTestCatalog()
    let vm = SurfaceViewModel(surfaceID: "s1", catalog: catalog)
    group.addSurface(vm)
    group.removeSurface(id: "s1")
    #expect(group.surfaces["s1"] == nil)
    #expect(group.surfaces.isEmpty)
  }
}
