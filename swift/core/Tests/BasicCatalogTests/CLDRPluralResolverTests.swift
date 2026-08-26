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

import BasicCatalog
import Testing

struct CLDRPluralResolverTests {
  @Test(
    arguments: [
      ("en-US", 0.0, "other"),
      ("en-US", 1.0, "one"),
      ("en-US", 2.0, "other"),
      ("en-US", -1.0, "one"),
      ("en-US", 1.5, "other"),
      ("de", 1.0, "one"),
      ("de", 2.0, "other"),
      ("zh-CN", 1.0, "other"),
      ("tr", 1.0, "one"),
      ("tr", 2.0, "other"),
      ("hi", 0.0, "one"),
      ("hi", 0.5, "one"),
      ("hi", 2.0, "other"),
      ("ff", 0.0, "one"),
      ("ff", 1.5, "one"),
      ("ak", 0.0, "one"),
      ("ak", 1.0, "one"),
      ("ak", 0.5, "other"),
      ("tzm", 11.0, "one"),
      ("tzm", 99.0, "one"),
      ("tzm", 100.0, "other"),
      ("si", 0.0, "one"),
      ("si", 0.1, "one"),
      ("si", 0.2, "other"),
      ("da", 0.5, "one"),
      ("da", 2.5, "other"),
      ("is", 21.0, "one"),
      ("is", 11.0, "other"),
      ("is", 0.1, "one"),
      ("mk", 21.0, "one"),
      ("mk", 11.0, "other"),
      ("mk", 0.1, "one"),
      ("ceb", 4.0, "other"),
      ("ceb", 5.0, "one"),
      ("fil", 1.4, "other"),
      ("fil", 1.5, "one"),
      ("lv", 0.0, "zero"),
      ("lv", 1.0, "one"),
      ("lv", 11.0, "zero"),
      ("lv", 0.1, "one"),
      ("lv", 0.11, "zero"),
      ("lv", 0.2, "other"),
      ("lag", 0.0, "zero"),
      ("lag", 0.5, "one"),
      ("lag", 2.0, "other"),
      ("cv", 0.0, "zero"),
      ("cv", 1.0, "one"),
      ("cv", 2.0, "other"),
      ("he", 0.5, "one"),
      ("he", 1.0, "one"),
      ("he", 2.0, "two"),
      ("he", 3.0, "other"),
      ("se", 1.0, "one"),
      ("se", 2.0, "two"),
      ("se", 3.0, "other"),
      ("shi", 0.0, "one"),
      ("shi", 2.0, "few"),
      ("shi", 11.0, "other"),
      ("ro", 1.0, "one"),
      ("ro", 0.0, "few"),
      ("ro", 2.0, "few"),
      ("ro", 20.0, "other"),
      ("ro", 1.5, "few"),
      ("sr", 1.0, "one"),
      ("sr", 2.0, "few"),
      ("sr", 5.0, "other"),
      ("sr", 0.1, "one"),
      ("sr", 0.2, "few"),
      ("fr", 0.0, "one"),
      ("fr", 1.5, "one"),
      ("fr", 2.0, "other"),
      ("fr", 1_000_000.0, "many"),
      ("pt-BR", 0.0, "one"),
      ("pt-BR", 1.5, "one"),
      ("pt-BR", 2.0, "other"),
      ("pt-BR", 1_000_000.0, "many"),
      ("pt-PT", 0.0, "other"),
      ("pt-PT", 1.0, "one"),
      ("pt-PT", 1.5, "other"),
      ("pt-PT", 1_000_000.0, "many"),
      ("it", 1.0, "one"),
      ("it", 1.5, "other"),
      ("it", 1_000_000.0, "many"),
      ("es", 1.0, "one"),
      ("es", 0.0, "other"),
      ("es", 1_000_000.0, "many"),
      ("gd", 1.0, "one"),
      ("gd", 2.0, "two"),
      ("gd", 3.0, "few"),
      ("gd", 11.0, "one"),
      ("gd", 12.0, "two"),
      ("gd", 20.0, "other"),
      ("sl", 1.0, "one"),
      ("sl", 2.0, "two"),
      ("sl", 3.0, "few"),
      ("sl", 0.5, "few"),
      ("sl", 5.0, "other"),
      ("hsb", 1.0, "one"),
      ("hsb", 2.0, "two"),
      ("hsb", 3.0, "few"),
      ("hsb", 0.1, "one"),
      ("hsb", 0.2, "two"),
      ("hsb", 0.3, "few"),
      ("hsb", 0.5, "other"),
      ("cs", 1.0, "one"),
      ("cs", 2.0, "few"),
      ("cs", 5.0, "other"),
      ("cs", 1.5, "many"),
      ("pl", 1.0, "one"),
      ("pl", 2.0, "few"),
      ("pl", 5.0, "many"),
      ("pl", 0.5, "other"),
      ("be", 1.0, "one"),
      ("be", 2.0, "few"),
      ("be", 5.0, "many"),
      ("be", 0.5, "other"),
      ("lt", 1.0, "one"),
      ("lt", 2.0, "few"),
      ("lt", 10.0, "other"),
      ("lt", 0.5, "many"),
      ("ru", 1.0, "one"),
      ("ru", 2.0, "few"),
      ("ru", 5.0, "many"),
      ("ru", 0.5, "other"),
      ("sgs", 1.0, "one"),
      ("sgs", 2.0, "two"),
      ("sgs", 3.0, "few"),
      ("sgs", 11.0, "other"),
      ("sgs", 0.5, "many"),
      ("br", 1.0, "one"),
      ("br", 2.0, "two"),
      ("br", 3.0, "few"),
      ("br", 1_000_000.0, "many"),
      ("br", 5.0, "other"),
      ("mt", 1.0, "one"),
      ("mt", 2.0, "two"),
      ("mt", 3.0, "few"),
      ("mt", 11.0, "many"),
      ("mt", 20.0, "other"),
      ("ga", 1.0, "one"),
      ("ga", 2.0, "two"),
      ("ga", 3.0, "few"),
      ("ga", 7.0, "many"),
      ("ga", 11.0, "other"),
      ("gv", 1.0, "one"),
      ("gv", 2.0, "two"),
      ("gv", 20.0, "few"),
      ("gv", 0.5, "many"),
      ("gv", 3.0, "other"),
      ("kw", 0.0, "zero"),
      ("kw", 1.0, "one"),
      ("kw", 2.0, "two"),
      ("kw", 3.0, "few"),
      ("kw", 21.0, "many"),
      ("kw", 4.0, "other"),
      ("kw", 1_000.0, "two"),
      ("ar", 0.0, "zero"),
      ("ar", 1.0, "one"),
      ("ar", 2.0, "two"),
      ("ar", 3.0, "few"),
      ("ar", 11.0, "many"),
      ("ar", 100.0, "other"),
      ("ar", 0.5, "other"),
      ("cy", 0.0, "zero"),
      ("cy", 1.0, "one"),
      ("cy", 2.0, "two"),
      ("cy", 3.0, "few"),
      ("cy", 6.0, "many"),
      ("cy", 4.0, "other"),
    ]
  )
  func matchesCLDR48(localeIdentifier: String, value: Double, expected: String) {
    let resolver = CLDRPluralResolver(localeIdentifier: localeIdentifier)
    #expect(resolver.pluralCategory(for: value).rawValue == expected)
  }

  @Test(
    arguments: [
      ("en-US", "en_US", 1.0, "one"),
      ("en-US", "en_US", 2.0, "other"),
      ("pt-PT", "pt_PT", 0.0, "other"),
      ("pt-PT", "pt_PT.UTF-8", 0.0, "other"),
      ("pt-PT", "pt_PT@currency=EUR", 0.0, "other"),
      ("zh-Hans-CN", "zh_Hans_CN", 1.0, "other"),
    ]
  )
  func acceptsBCP47AndPOSIXIdentifiers(
    bcp47: String,
    posix: String,
    value: Double,
    expected: String
  ) {
    let bcp47Category = CLDRPluralResolver(localeIdentifier: bcp47).pluralCategory(for: value)
    let posixCategory = CLDRPluralResolver(localeIdentifier: posix).pluralCategory(for: value)
    #expect(bcp47Category.rawValue == expected)
    #expect(posixCategory == bcp47Category)
  }

  @Test func returnsOtherForUnknownLocales() {
    let resolver = CLDRPluralResolver(localeIdentifier: "xx")
    #expect(resolver.pluralCategory(for: 1) == .other)
  }

  @Test(arguments: [Double.nan, Double.infinity, -Double.infinity])
  func returnsOtherForNonFiniteValues(value: Double) {
    let resolver = CLDRPluralResolver(localeIdentifier: "ar")
    #expect(resolver.pluralCategory(for: value) == .other)
  }
}
