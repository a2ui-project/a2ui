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
import SwiftUI
import Testing

@testable import BasicCatalogSwiftUI

@MainActor
struct A2UIDateTimeInputTests {

  @Test func dateTimeInputInitializesWithProperties() {
    let node = Node(
      id: "dt1",
      type: "DateTimeInput",
      properties: [
        "label": "Event Date",
        "value": "2024-12-15T14:30:00Z",
        "enableDate": true,
        "enableTime": true,
        "min": "2024-01-01T00:00:00Z",
        "max": "2025-12-31T23:59:59Z",
      ]
    )

    let view = A2UIDateTimeInput(node: node)
    #expect(node.string(for: "label") == "Event Date")
    #expect(node.string(for: "value") == "2024-12-15T14:30:00Z")
    #expect(node.bool(for: "enableDate") == true)
    #expect(node.bool(for: "enableTime") == true)
    #expect(node.string(for: "min") == "2024-01-01T00:00:00Z")
    #expect(node.string(for: "max") == "2025-12-31T23:59:59Z")
    _ = view.body
  }

  @Test func dateTimeInputRendersDateOnly() {
    let node = Node(
      id: "dtDateOnly",
      type: "DateTimeInput",
      properties: [
        "label": "Birthday",
        "value": "1990-05-20",
        "enableDate": true,
        "enableTime": false,
      ]
    )

    let view = A2UIDateTimeInput(node: node)
    _ = view.body
  }

  @Test func dateTimeInputRendersTimeOnly() {
    let node = Node(
      id: "dtTimeOnly",
      type: "DateTimeInput",
      properties: [
        "label": "Alarm",
        "value": "08:30:00",
        "enableDate": false,
        "enableTime": true,
      ]
    )

    let view = A2UIDateTimeInput(node: node)
    _ = view.body
  }

  @Test func dateTimeInputRendersFromCatalog() throws {
    let catalog = BasicCatalogImplementation.v091Catalog

    let node = Node(
      id: "dtCatalog",
      type: "DateTimeInput",
      properties: [
        "label": "Booking Date",
        "value": "2024-12-25",
        "enableDate": true,
      ]
    )

    let rendered = Surface.render(node: node, using: [catalog.id: catalog])
    #expect(rendered != nil)
  }

  @Test func dateTimeInputDateOnlyBindingRoundTrip() throws {
    let binding = DataBinding<String>(
      identity: .path("/date"),
      value: "2024-12-25",
      set: { _ in }
    )
    let node = Node(
      id: "dtRoundTrip",
      type: "DateTimeInput",
      properties: [
        "label": "Trip Date",
        "value": binding,
        "enableDate": true,
        "enableTime": false,
      ]
    )

    let view = A2UIDateTimeInput(node: node)
    _ = view.body
    #expect(node.string(for: "value") == "2024-12-25")
  }
}
