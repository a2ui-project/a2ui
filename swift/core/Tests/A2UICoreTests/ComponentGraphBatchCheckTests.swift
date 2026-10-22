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
import A2UIJSON
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

/// Checks that ``MessageProcessor``, which checks an `updateComponents` batch under a relaxed
/// config against what the batch changes, accepts and rejects the batches that a check of the
/// whole surface by ``GraphTopologyValidator`` accepts and rejects, with the same kind of error.
@MainActor
struct ComponentGraphBatchCheckTests {
  private static let catalogID = "c"

  @Test func childArrivesAfterItsContainer() throws {
    try expectSameOutcomes(
      [
        [column("root", children: ["a"])],
        [text("a")],
      ],
      catalog: try compositionCatalog()
    )
  }

  @Test func containerArrivesAfterItsChild() throws {
    try expectSameOutcomes(
      [
        [card("a", child: "b")],
        [text("b")],
        [column("root", children: ["a"])],
      ],
      catalog: try compositionCatalog()
    )
  }

  @Test func disallowedChildAddedInLaterMessageIsRejected() throws {
    let outcomes = try expectSameOutcomes(
      [
        [card("a", child: "b")],
        [column("b", children: [])],
      ],
      catalog: try compositionCatalog()
    )
    #expect(outcomes == [true, false])
  }

  @Test func containerRewrittenToDropDisallowedChild() throws {
    try expectSameOutcomes(
      [
        [column("root", children: ["a"]), card("b", child: "c")],
        [card("a", child: "x")],
        [column("x", children: [])],
        [card("a", child: "y")],
        [column("x", children: [])],
      ],
      catalog: try compositionCatalog()
    )
  }

  @Test func heldChildWhoseTypeChanges() throws {
    let outcomes = try expectSameOutcomes(
      [
        [card("a", child: "b"), text("b")],
        [column("b", children: [])],
        [row("b", children: [])],
      ],
      catalog: try compositionCatalog()
    )
    #expect(outcomes == [true, false, false])
  }

  @Test func holderThatChildDoesNotAllow() throws {
    let outcomes = try expectSameOutcomes(
      [
        [row("r", children: ["a"])],
        [card("a", child: nil)],
      ],
      catalog: try compositionCatalog()
    )
    #expect(outcomes == [true, false])
  }

  @Test func rootTheSurfaceMayNotHold() throws {
    let outcomes = try expectSameOutcomes(
      [
        [column("a", children: ["root"])],
        [card("root", child: nil)],
        [row("root", children: [])],
      ],
      catalog: try compositionCatalog()
    )
    #expect(outcomes == [true, false, true])
  }

  @Test func cycleClosedByLaterMessageIsRejected() throws {
    let outcomes = try expectSameOutcomes(
      [
        [column("a", children: ["b"])],
        [column("b", children: ["c"])],
        [column("c", children: ["a"])],
        [column("c", children: ["b"])],
        [column("c", children: [])],
      ],
      catalog: try plainCatalog()
    )
    #expect(outcomes == [true, true, false, false, true])
  }

  @Test func selfReferenceIsRejected() throws {
    let outcomes = try expectSameOutcomes(
      [[column("a", children: [])], [column("a", children: ["a"])]],
      catalog: try plainCatalog()
    )
    #expect(outcomes == [true, false])
  }

  @Test func chainDeeperThanDepthLimitIsRejected() throws {
    // c0 references c1, which references c2, and so on; the chain arrives from its end.
    let batches = (0...55).reversed().map { index in
      [column("c\(index)", children: ["c\(index + 1)"])]
    }
    let outcomes = try expectSameOutcomes(batches, catalog: try plainCatalog())
    #expect(outcomes.contains(false))
  }

  @Test func chainJoinedInTheMiddleIsChecked() throws {
    // Two chains of 30 joined by one reference make a chain of 61.
    var batches = (0..<30).map { [column("a\($0)", children: ["a\($0 + 1)"])] }
    batches += (0..<30).map { [column("b\($0)", children: ["b\($0 + 1)"])] }
    batches.append([column("a30", children: ["b0"])])
    let outcomes = try expectSameOutcomes(batches, catalog: try plainCatalog())
    #expect(outcomes.last == false)
  }

  @Test func cycleClosedThroughArrayOfComponentIdIsRejected() throws {
    // `slots` is declared as an array of ComponentId, which the whole-surface check reads as
    // child references, and so must the check of a batch.
    let outcomes = try expectSameOutcomes(
      [
        [stack("a", slots: ["b"])],
        [stack("b", slots: ["c"])],
        [stack("c", slots: ["a"])],
        [stack("c", slots: [])],
      ],
      catalog: try plainCatalog()
    )
    #expect(outcomes == [true, true, false, true])
  }

  @Test(arguments: [false, true])
  func sameCountChangeOutsideProcessorIsChecked(throughApplyBatch: Bool) throws {
    let processor = try makeProcessor(catalog: try plainCatalog())
    try send([column("a", children: ["b"])], to: processor)
    try send([column("b", children: [])], to: processor)

    // The host closes a cycle by replacing `b`, which leaves the number of components as it was.
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["s"])
    let replacement = ComponentModel(
      id: "b",
      type: "Column",
      catalogID: Self.catalogID,
      properties: ["children": .array([.string("a")])]
    )
    if throughApplyBatch {
      surface.componentsModel.applyBatch(adding: [replacement])
    } else {
      surface.componentsModel.addComponent(replacement)
    }
    #expect(surface.componentsModel.components.count == 2)

    // The next batch is checked against the surface as it is, which holds the cycle.
    #expect(throws: A2UIRecursionError.self) {
      try send([text("t")], to: processor)
    }
  }

  @Test func randomSequencesUnderCompositionConstraints() throws {
    try runRandomSequences(catalog: try compositionCatalog(), seed: 1)
  }

  @Test func randomSequencesWithoutConstraints() throws {
    try runRandomSequences(catalog: try plainCatalog(), seed: 2)
  }

  // MARK: - Helpers

  private func runRandomSequences(catalog: AnyCatalog, seed: UInt64) throws {
    var generator = SplitMix64(seed: seed)
    let ids = ["root", "a", "b", "c", "d", "e", "f"]
    for _ in 0..<200 {
      var batches: [[[String: JSONValue]]] = []
      for _ in 0..<20 {
        let count = Int.random(in: 1...3, using: &generator)
        let batchIDs = ids.shuffled(using: &generator).prefix(count)
        batches.append(
          batchIDs.map { id in
            let children = (0..<Int.random(in: 0...3, using: &generator)).compactMap { _ in
              ids.randomElement(using: &generator)
            }
            switch Int.random(in: 0..<4, using: &generator) {
            case 0: return column(id, children: Array(Set(children)).sorted())
            case 1: return row(id, children: Array(Set(children)).sorted())
            case 2: return card(id, child: children.first)
            default: return text(id)
            }
          }
        )
      }
      try expectSameOutcomes(batches, catalog: catalog)
    }
  }

  /// Sends each batch to a processor under the relaxed config and checks the whole surface with
  /// the batch applied through ``GraphTopologyValidator``, expecting both to accept the batch or
  /// both to reject it with the same kind of error. Returns whether each batch was accepted.
  @discardableResult
  private func expectSameOutcomes(
    _ batches: [[[String: JSONValue]]],
    catalog: AnyCatalog
  ) throws -> [Bool] {
    let processor = try makeProcessor(catalog: catalog)
    var held: [String: [String: JSONValue]] = [:]
    var outcomes: [Bool] = []
    for batch in batches {
      var applied = held
      for component in batch {
        if let id = component["id"]?.stringValue { applied[id] = component }
      }
      var expectedError: Error?
      do {
        try GraphTopologyValidator.validate(
          components: Array(applied.values),
          rootID: "root",
          config: .relaxed,
          catalogs: [Self.catalogID: catalog],
          defaultCatalogID: Self.catalogID
        )
      } catch {
        expectedError = error
      }
      var actualError: Error?
      do {
        try send(batch, to: processor)
      } catch {
        actualError = error
      }
      // A surface can break several rules at once, and the whole-surface check reports the
      // first it meets in dictionary order, so only the kind of error is compared.
      #expect(
        actualError.map { "\(type(of: $0))" } == expectedError.map { "\(type(of: $0))" },
        "batch \(outcomes.count): \(batch), \(String(describing: actualError))"
      )
      if expectedError == nil { held = applied }
      outcomes.append(actualError == nil)
      let surface = try #require(processor.surfaceGroupModel.surfacesMap["s"])
      #expect(Set(surface.componentsModel.components.keys) == Set(held.keys))
    }
    return outcomes
  }

  /// A processor under the relaxed config holding surface `s` in the catalog `catalog`.
  private func makeProcessor(catalog: AnyCatalog) throws -> MessageProcessor {
    let processor = MessageProcessor(catalogs: [catalog], validationConfig: .relaxed)
    try processor.processMessages(
      .array([
        .object([
          "version": "v1.0",
          "createSurface": .object([
            "surfaceId": "s", "catalogId": .string(Self.catalogID),
          ]),
        ])
      ])
    )
    return processor
  }

  /// Sends `batch` to surface `s` of `processor` in an `updateComponents` message.
  private func send(_ batch: [[String: JSONValue]], to processor: MessageProcessor) throws {
    try processor.processMessages(
      .array([
        .object([
          "version": "v1.0",
          "updateComponents": .object([
            "surfaceId": "s",
            "components": .array(batch.map(object)),
          ]),
        ])
      ])
    )
  }

  private func object(_ component: [String: JSONValue]) -> JSONValue {
    .object(OrderedDictionary(uniqueKeysWithValues: component.sorted { $0.key < $1.key }))
  }

  private func column(_ id: String, children: [String]) -> [String: JSONValue] {
    ["id": .string(id), "component": "Column", "children": .array(children.map { .string($0) })]
  }

  private func row(_ id: String, children: [String]) -> [String: JSONValue] {
    ["id": .string(id), "component": "Row", "children": .array(children.map { .string($0) })]
  }

  private func card(_ id: String, child: String?) -> [String: JSONValue] {
    var component: [String: JSONValue] = ["id": .string(id), "component": "Card"]
    if let child { component["child"] = .string(child) }
    return component
  }

  private func stack(_ id: String, slots: [String]) -> [String: JSONValue] {
    ["id": .string(id), "component": "Stack", "slots": .array(slots.map { .string($0) })]
  }

  private func text(_ id: String) -> [String: JSONValue] {
    ["id": .string(id), "component": "Text", "text": "Hello"]
  }

  /// A catalog whose components declare `allowedParents` and `allowedChildren`.
  ///
  /// A `Column` holds any component, a `Row` may sit on the surface or in a `Column`, a `Card`
  /// sits in a `Column` and holds a `Text`, and a `Text` sits in a `Column` or a `Card`.
  private func compositionCatalog() throws -> AnyCatalog {
    try catalog(
      constraints: [
        "Column": (nil, ["Column", "Row", "Card", "Text"]),
        "Row": (["Surface", "Column"], nil),
        "Card": (["Column"], ["Text"]),
        "Text": (["Column", "Card"], nil),
      ]
    )
  }

  private func plainCatalog() throws -> AnyCatalog {
    try catalog(constraints: [:])
  }

  private func catalog(
    constraints: [String: (allowedParents: [String]?, allowedChildren: [String]?)]
  ) throws -> AnyCatalog {
    let listSchema = try Schema(
      instance: """
        {"type": "object", "properties": {"children": {"type": "array",
          "description": "REF:common_types.json#/$defs/ChildList", "items": {"type": "string"}}}}
        """
    )
    let childSchema = try Schema(
      instance: """
        {"type": "object", "properties": {"child": {"type": "string",
          "description": "REF:common_types.json#/$defs/ComponentId"}}}
        """
    )
    let slotsSchema = try Schema(
      instance: """
        {"type": "object", "properties": {"slots": {"type": "array", "items": {
          "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"}}}}
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let textSchema = try Schema(instance: #"{"type": "object"}"#)
    let schemas = [
      "Column": listSchema, "Row": listSchema, "Card": childSchema, "Stack": slotsSchema,
      "Text": textSchema,
    ]
    return Catalog(
      id: Self.catalogID,
      protocolVersion: "v1.0",
      components: schemas.map { name, schema in
        AnyComponentAPI(
          name: name,
          schema: schema,
          allowedParents: constraints[name]?.allowedParents,
          allowedChildren: constraints[name]?.allowedChildren
        )
      }
    )
  }
}

/// A seeded generator, so that the random sequences are the same on every run.
private struct SplitMix64: RandomNumberGenerator {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed
  }

  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var value = state
    value = (value ^ (value >> 30)) &* 0xBF58_476D_1CE4_E5B9
    value = (value ^ (value >> 27)) &* 0x94D0_49BB_1331_11EB
    return value ^ (value >> 31)
  }
}
