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
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Foundation
import OrderedJSON
import Testing

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

@MainActor
struct BasicCatalogImplementationLocaleTests {

  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  private func formatNumber(
    in catalog: Catalog<ComponentImplementation>
  ) throws -> JSONValue {
    let function = try #require(catalog.functions["formatNumber"])
    return try function.evaluate(
      arguments: ["value": .number(1234.5), "decimals": .number(2)], context: context)
  }

  @Test(arguments: A2UIProtocolVersion.allCases)
  func makeCatalogFormatsInEnglishUSByDefault(version: A2UIProtocolVersion) throws {
    let catalog = BasicCatalogImplementation.makeCatalog(version: version)
    #expect(try formatNumber(in: catalog) == .string("1,234.50"))
  }

  @Test(arguments: A2UIProtocolVersion.allCases)
  func makeCatalogWithLocaleFormatsInThatLocale(version: A2UIProtocolVersion) throws {
    let catalog = BasicCatalogImplementation.makeCatalog(
      version: version, locale: Locale(identifier: "de_DE"))
    let defaultCatalog = BasicCatalogImplementation.makeCatalog(version: version)

    #expect(catalog.id == defaultCatalog.id)
    #expect(catalog.protocolVersion == defaultCatalog.protocolVersion)
    #expect(catalog.components.count == defaultCatalog.components.count)
    #expect(catalog.functions.count == defaultCatalog.functions.count)
    #expect(try formatNumber(in: catalog) == .string("1.234,50"))
  }
}
