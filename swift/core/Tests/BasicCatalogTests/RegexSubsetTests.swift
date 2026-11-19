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
import Testing

@testable import BasicCatalog

struct RegexSubsetTests {
  @Test func parsesValidPortableSubsetConstructs() throws {
    let validPatterns = [
      "",
      "abc",
      "^abc$",
      "\\bword\\B",
      "a|b|c",
      "(abc)",
      "(?:abc)",
      "(?=abc)abc",
      "(?!abc)def",
      "a*b+c?d{2}e{2,}f{2,5}",
      "a*?b+?c??d{2,5}?",
      "[a-zA-Z0-9_-]",
      "[^0-9]",
      "[\\d\\w\\s\\D\\W\\S]",
      "\\t\\n\\r\\f\\v",
      "\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/",
      "\\x41\\u0042\\u{43}\\u{1F600}",
      "\\0",
      "[\\b]",
      "a{1,1000}",
      "[-a]",
      "[a-]",
      "[\\-a]",
      ".",
    ]
    for pattern in validPatterns {
      let res = RegexSubset.analyze(pattern)
      #expect(res.ok, "Expected valid pattern: \(pattern)")
      #expect(res.ast != nil)
    }
  }

  @Test func rejectsUnsupportedSyntaxWithToken() {
    let invalidPatterns = [
      "(a)\\1",
      "\\1",
      "(?<name>a)",
      "(?<=a)b",
      "(?<!a)b",
      "(?i)abc",
      "(?i:abc)",
      "(?>abc)",
      "a*+",
      "a++",
      "a?+",
      "a{2,3}+",
      "\\p{L}",
      "\\P{N}",
      "\\k<name>",
      "\\A",
      "\\Z",
      "\\z",
      "\\a",
      "\\e",
      "\\cA",
      "\\01",
      "\\-",
      "[[:alpha:]]",
      "[a&&b]",
      "[a--b]",
      "[a[b]]",
      "[]",
      "[^]",
      "[z-a]",
      "[\\d-z]",
      "[a-\\d]",
      "a{65536}",
      "a{1,65536}",
      "a{5,3}",
      "a{}",
      "a{,3}",
      "{2}",
      "*",
      "+",
      "?",
      "^*",
      "(?=a)+",
      "(abc",
      "abc)",
      "[abc",
      "abc]",
      "abc}",
      "\\",
      "\\x4",
      "\\xGG",
      "\\u004",
      "\\uD800",
      "\\u{D800}",
      "\\u{110000}",
      "\\u{}",
    ]
    for pattern in invalidPatterns {
      let res = RegexSubset.analyze(pattern)
      #expect(!res.ok, "Expected rejected pattern: \(pattern)")
      #expect(res.reason == .unsupportedSyntax)
    }
  }

  @Test func rule1Enforces256CodePointLimit() {
    let ok256 = String(repeating: "a", count: 256)
    #expect(RegexSubset.analyze(ok256).ok)
    let tooLong257 = String(repeating: "a", count: 257)
    let rejected = RegexSubset.analyze(tooLong257)
    #expect(!rejected.ok)
    #expect(rejected.reason == .patternTooLong)

    let emoji256 = String(repeating: "😀", count: 256)
    #expect(RegexSubset.analyze(emoji256).ok)
    let emoji257 = String(repeating: "😀", count: 257)
    let rejectedEmoji = RegexSubset.analyze(emoji257)
    #expect(!rejectedEmoji.ok)
    #expect(rejectedEmoji.reason == .patternTooLong)
  }

  @Test func rule2RejectsNestedQuantifiers() {
    let evil = [
      "(a+)+",
      "(a*)*",
      "(a+)*",
      "(a*){2,5}",
      "(?:a+){2}",
      "([a-z]*)*",
      "(a|b+)+",
      "((?:a+))+",
      "(\\d+){2,}",
    ]
    for pattern in evil {
      let res = RegexSubset.analyze(pattern)
      #expect(!res.ok, "Expected nested quantifier rejection: \(pattern)")
      #expect(res.reason == .nestedQuantifier)
    }

    let safe = [
      "(?:ab+)?c",
      "(a+){0,1}",
      "(\\d{1,3}){1,4}",
      "(a{1,2})+",
    ]
    for pattern in safe {
      #expect(RegexSubset.analyze(pattern).ok, "Expected safe: \(pattern)")
    }
  }

  @Test func rule2RejectsRepetitionOfAmbiguousNullableGroup() {
    // A repeat that runs its child more than once multiplies every way the child can match. The
    // ICU engine behind `NSRegularExpression` runs for seconds on each of these patterns with a
    // value only a few characters long, with or without an upper bound on the repeat.
    let evil = [
      "(a?){1000}a{1000}",
      "(a?){500}a{500}",
      "(?:a?){1000}a{1000}",
      "((a?)){1000}a{1000}",
      "(a?b?){100}a{1000}",
      "(a|b?){1000}a{1000}",
      "(a|){1000}a{1000}",
      "(a{0,2}){2}",
      "((?:a?){1}){2}",
      "(a?){1000,}a{1000}",
      "(a|b?){300,}a{300}",
      "(a{0,2})+b",
      "(a?)*a{1000}",
    ]
    for pattern in evil {
      let result = RegexSubset.analyze(pattern)
      #expect(!result.ok, "Expected nested quantifier rejection: \(pattern)")
      #expect(result.reason == .nestedQuantifier, "Unexpected reason for \(pattern)")
    }

    let safe = [
      "(?:ab?){3}c",
      "(?:ab?){0,2}",
      "(a|b){2,4}",
      "(?:\\d{2,4}){2}",
      "(a?){1}",
      "(a?){0,1}",
      "(?:ab?)+c",
    ]
    for pattern in safe {
      #expect(RegexSubset.analyze(pattern).ok, "Expected safe: \(pattern)")
    }
  }

  @Test func rule2RejectsCountedNullableRepetitionBeforeMatching() throws {
    // Only the analysis runs here: matching this pattern against "aaa!" does not return within
    // five seconds, so the evaluation below uses an empty value and relies on the guard throwing
    // before any match starts.
    let pattern = "(a?){1000}a{1000}"
    let clock = ContinuousClock()
    let elapsed = clock.measure {
      #expect(RegexSubset.analyze(pattern).reason == .nestedQuantifier)
    }
    #expect(elapsed < .seconds(1))

    let error = #expect(throws: FunctionError.self) {
      _ = try RegexSubset.test(pattern: pattern, value: "")
    }
    let message = try #require(error.map { "\($0)" })
    #expect(message.contains("NESTED_QUANTIFIER"))
  }

  @Test func rule3RejectsOverlappingAlternationInRepetition() {
    let evil = [
      "(a|ab)+",
      "(a|ab)*c",
      "(\\d|[0-5])+",
      "(\\w|\\d)+",
      "([a-m]|[g-z])*",
    ]
    for pattern in evil {
      let res = RegexSubset.analyze(pattern)
      #expect(!res.ok, "Expected overlapping alternation rejection: \(pattern)")
      #expect(res.reason == .overlappingAlternation)
    }

    let safe = [
      "(a|b)*c",
      "(cat|dog)+",
      "(a|ab)",
      "(a|ab)?",
      "(\\d|[a-f])+",
    ]
    for pattern in safe {
      #expect(RegexSubset.analyze(pattern).ok, "Expected safe: \(pattern)")
    }
  }

  @Test func rule4RejectsAdjacentOverlappingUnboundedQuantifiers() {
    let evil = [
      "\\d+\\d+",
      ".*.*",
      "\\d+\\s*\\d+",
      "\\w+\\d+",
      "a+a+",
      ".*a*.*",
      "\\s*.*",
      "(\\d+)(\\d+)",
      "\\d+\\b\\d+",
    ]
    for pattern in evil {
      let res = RegexSubset.analyze(pattern)
      #expect(!res.ok, "Expected adjacent overlap rejection: \(pattern)")
      #expect(res.reason == .adjacentOverlap)
    }

    let safe = [
      "^\\d+-\\d+$",
      "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      "\\d+[a-z]+\\d+",
      "\\d{1,3}\\d+",
    ]
    for pattern in safe {
      #expect(RegexSubset.analyze(pattern).ok, "Expected safe: \(pattern)")
    }
  }

  @Test func translatesToICUSemantics() throws {
    #expect(try RegexSubset.test(pattern: "^abc$", value: "abc") == true)
    #expect(try RegexSubset.test(pattern: "^abc$", value: "abc\n") == false)
    #expect(try RegexSubset.test(pattern: "^\\d+$", value: "123") == true)
    #expect(try RegexSubset.test(pattern: "^\\d+$", value: "١٢٣") == false)
    #expect(try RegexSubset.test(pattern: "^\\w+$", value: "foo_1") == true)
    #expect(try RegexSubset.test(pattern: "^\\w+$", value: "café") == false)
    #expect(try RegexSubset.test(pattern: "\\bcat\\b", value: "a cat!") == true)
    #expect(try RegexSubset.test(pattern: "\\bcat\\b", value: "écat") == true)
    #expect(try RegexSubset.test(pattern: "^.$", value: "😀") == true)
    #expect(try RegexSubset.test(pattern: "^\\u{00000041}$", value: "A") == true)
    #expect(try RegexSubset.test(pattern: "[^\\s\\S]+", value: "abc") == false)

    let ok4096 = String(repeating: "a", count: 4096)
    #expect(try RegexSubset.test(pattern: "^a+$", value: ok4096) == true)
    let tooLong4097 = String(repeating: "a", count: 4097)
    #expect(try RegexSubset.test(pattern: "^a+$", value: tooLong4097) == nil)
  }
}
