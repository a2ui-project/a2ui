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

import A2UICore
import BasicCatalog
import Testing

@MainActor
struct BasicCatalogVersioningTests {
  @Test func versionedCatalogStructuresMatchForwardingAPIs() {
    #expect(V09BasicCatalog.components.count == 18)
    #expect(V10BasicCatalog.components.count == 18)

    #expect(BasicCatalog.makeCatalog(version: .v09).id == V09BasicCatalog.catalogURI)
    #expect(BasicCatalog.makeCatalog(version: .v091).id == V09BasicCatalog.v091CatalogURI)
    #expect(BasicCatalog.makeCatalog(version: .v10).id == V10BasicCatalog.catalogURI)
    #expect(BasicCatalog.catalogURI(version: .v09) == V09BasicCatalog.catalogURI)
    #expect(BasicCatalog.catalogURI(version: .v091) == V09BasicCatalog.v091CatalogURI)
    #expect(BasicCatalog.catalogURI(version: .v10) == V10BasicCatalog.catalogURI)

    #expect(BasicCatalogComponents.allComponents.count == 18)
    #expect(BasicCatalogComponents.v10Components.count == 18)
    #expect(BasicCatalogComponents.text.name == V09BasicCatalogComponents.text.name)
    #expect(BasicCatalogComponents.v10Text.name == V10BasicCatalogComponents.text.name)
    #expect(V09BasicCatalogComponents.button.name == "Button")
    #expect(V10BasicCatalogComponents.button.name == "Button")

    #expect(V09BasicFunctions.allFunctions.count == 14)
    #expect(V10BasicFunctions.allFunctions.count == 15)
    #expect(BasicFunctions.v09Functions.count == 14)
    #expect(BasicFunctions.v10Functions.count == 15)
  }
}
