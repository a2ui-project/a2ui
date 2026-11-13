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

package core

import (
	"fmt"

	"github.com/a2ui-project/a2ui/go/core/internal/regexsubset"
)

const (
	// MaxRegexPatternCodePoints is the maximum allowed code points in an A2UI regex pattern.
	MaxRegexPatternCodePoints = regexsubset.MaxPatternCodePoints
	// MaxRegexValueCodePoints is the maximum value length in code points evaluated by RegexTest.
	MaxRegexValueCodePoints = regexsubset.MaxValueCodePoints
)

// CheckRegexSafety parses pattern against the portable A2UI ECMAScript regex subset
// and enforces the static ReDoS safety rules, returning an *ExpressionError on rejection.
func CheckRegexSafety(pattern string) error {
	analysis := regexsubset.AnalyzeCached(pattern)
	if !analysis.OK || analysis.Tree == nil {
		return NewExpressionError(fmt.Sprintf("Invalid or unsafe regex pattern (%s): %s", analysis.Reason, pattern))
	}
	return nil
}

// RegexTest validates pattern and evaluates whether value matches it under A2UI regex semantics.
// When value exceeds MaxRegexValueCodePoints (4096), matched is false and exceededCap is true without error.
func RegexTest(pattern, value string) (matched bool, exceededCap bool, err error) {
	analysis := regexsubset.AnalyzeCached(pattern)
	if !analysis.OK || analysis.Tree == nil {
		return false, false, NewExpressionError(fmt.Sprintf("Invalid or unsafe regex pattern (%s): %s", analysis.Reason, pattern))
	}
	m, exceeded := regexsubset.MatchTest(analysis.Tree, value)
	return m, exceeded, nil
}
