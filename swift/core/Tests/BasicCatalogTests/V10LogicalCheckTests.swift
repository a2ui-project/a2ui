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

/// Resolves the submit check of the basic catalog's v1.0 login form example
/// (`catalogs/basic/v1/examples/09_login-form.json`), whose `and` combines the
/// ValidationResult objects returned by `email` and `length`.
@MainActor
struct V10LogicalCheckTests {

  @Test func loginButtonCheckFailsForInvalidEmail() throws {
    let button = try resolveLoginButton(email: "not-an-email", password: "longenough")
    #expect(button.isValid == false)
    #expect(button.validationErrors == ["Please fix errors before signing in"])
  }

  @Test func loginButtonCheckFailsForShortPassword() throws {
    let button = try resolveLoginButton(email: "user@example.com", password: "short")
    #expect(button.isValid == false)
  }

  @Test func loginButtonCheckPassesForValidInput() throws {
    let button = try resolveLoginButton(email: "user@example.com", password: "longenough")
    #expect(button.isValid == true)
  }

  private func resolveLoginButton(email: String, password: String) throws -> Node {
    let catalog = BasicCatalog.makeCatalog(version: .v10)
    let componentsModel = SurfaceComponentsModel()
    componentsModel.addComponent(
      ComponentModel(
        id: "login_btn_text",
        type: "Text",
        properties: ["text": .string("Sign in")]
      )
    )
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "child": .string("login_btn_text"),
          "checks": .array([
            .object([
              "condition": .object([
                "@call": .string("and"),
                "args": .object([
                  "values": .array([
                    .object([
                      "@call": .string("email"),
                      "args": .object(["value": .object(["@path": .string("/email")])]),
                    ]),
                    .object([
                      "@call": .string("length"),
                      "args": .object([
                        "value": .object(["@path": .string("/password")]),
                        "min": .integer(8),
                      ]),
                    ]),
                  ])
                ]),
              ]),
              "message": .string("Please fix errors before signing in"),
            ])
          ]),
          "action": .object(["event": .object(["name": .string("login")])]),
        ]
      )
    )
    let resolver = NodeResolver(
      surfaceID: "login",
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: DataModel(
        initial: .object(["email": .string(email), "password": .string(password)])
      ),
      protocolVersion: .v10
    )
    return try #require(resolver.resolveTree())
  }
}
