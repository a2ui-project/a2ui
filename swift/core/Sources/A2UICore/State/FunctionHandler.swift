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

@MainActor
public protocol FunctionHandler: AnyObject, Sendable {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)?
  func handleFunctionError(_ error: any Error, functionName: String)

  /// Checks that the catalog a v1.0 function call runs in resolves: the catalog the call names,
  /// or the default catalog when it names none.
  ///
  /// ``DataContext`` calls this from v1.0 before looking up a catalog function, so that an
  /// unresolvable catalog is reported as a catalog fault rather than a missing function. The
  /// default implementation accepts every catalog.
  ///
  /// - Throws: An error, typically `A2UICatalogError`, if the catalog can't be resolved.
  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws
}

extension FunctionHandler {
  public func handleFunctionError(_ error: any Error, functionName: String) {}

  public func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {}
}
