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

package regexsubset

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAnalyzeAndMatchSubset(t *testing.T) {
	rejectCases := []struct {
		pattern string
		reason  RejectionReason
	}{
		{strings.Repeat("a", 257), RejectPatternTooLong},
		{`(a)\1`, RejectUnsupportedSyntax},
		{`(?<=a)b`, RejectUnsupportedSyntax},
		{`(?<n>a)`, RejectUnsupportedSyntax},
		{`(?i)a`, RejectUnsupportedSyntax},
		{`\p{L}`, RejectUnsupportedSyntax},
		{`(a+)+$`, RejectNestedQuantifier},
		{`(a*){2,5}`, RejectNestedQuantifier},
		{`(a|ab)*c`, RejectOverlappingAlternation},
		{`(\d|[0-5])+`, RejectOverlappingAlternation},
		{`\d+\d+`, RejectAdjacentOverlap},
		{`\d+\s*\d+`, RejectAdjacentOverlap},
	}
	for _, tc := range rejectCases {
		res := Analyze(tc.pattern)
		if res.OK {
			t.Fatalf("expected pattern %q to be rejected with %s, but succeeded", tc.pattern, tc.reason)
		}
		if res.Reason != tc.reason {
			t.Fatalf("pattern %q: got reason %s, want %s (%s)", tc.pattern, res.Reason, tc.reason, res.Detail)
		}
	}

	matchCases := []struct {
		pattern string
		value   string
		want    bool
	}{
		{`^abc$`, "abc\n", false},
		{`^\d+$`, "١٢٣", false},
		{`^\w+$`, "café", false},
		{`\b`, "é", false},
		{`^.$`, "😀", true},
		{`^\u{1F600}+$`, "😀😀", true},
		{`^(?=.*\d).{8,}$`, "secret42", true},
		{`^(?=.*\d).{8,}$`, "secretno", false},
		{`^(?!admin)\w+$`, "alice", true},
		{`^(?!admin)\w+$`, "admin", false},
		{`^(a?){65535}$`, "aaa", true},
	}
	for _, tc := range matchCases {
		res := Analyze(tc.pattern)
		if !res.OK {
			t.Fatalf("pattern %q unexpectedly failed analysis: %s (%s)", tc.pattern, res.Reason, res.Detail)
		}
		got, exceeded := MatchTest(res.Tree, tc.value)
		if exceeded {
			t.Fatalf("pattern %q value %q unexpectedly exceeded limit", tc.pattern, tc.value)
		}
		if got != tc.want {
			t.Fatalf("pattern %q on %q: got %v, want %v", tc.pattern, tc.value, got, tc.want)
		}
	}
}

func TestMatchTestIsNotCubicInValueLength(t *testing.T) {
	// Each of these used to take minutes on a value at the length limit because every start
	// position was evaluated separately and every alternation allocated a value-sized bitmap.
	tests := []struct {
		pattern string
		value   string
		want    bool
	}{
		{`(a|b)*c`, strings.Repeat("ab", MaxValueCodePoints/2), false},
		{`(a?){65535}c`, strings.Repeat("a", MaxValueCodePoints), false},
		{`(?:(?:a|b){1,1000})*c`, strings.Repeat("ba", MaxValueCodePoints/2), false},
		{`(a|b)*c`, strings.Repeat("ab", MaxValueCodePoints/2-1) + "c", true},
	}
	for _, tc := range tests {
		t.Run(tc.pattern, func(t *testing.T) {
			res := Analyze(tc.pattern)
			if !res.OK {
				t.Fatalf("pattern %q unexpectedly failed analysis: %s (%s)", tc.pattern, res.Reason, res.Detail)
			}
			done := make(chan bool, 1)
			go func() {
				got, _ := MatchTest(res.Tree, tc.value)
				done <- got
			}()
			select {
			case got := <-done:
				if got != tc.want {
					t.Fatalf("MatchTest(%q) on %d code points = %v, want %v", tc.pattern, len(tc.value), got, tc.want)
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("MatchTest(%q) on %d code points did not finish within 5s", tc.pattern, len(tc.value))
			}
		})
	}
}

func TestAnalyzeCachedIsBounded(t *testing.T) {
	tests := []struct {
		name    string
		pattern func(i int) string
	}{
		{"accepted patterns", func(i int) string { return fmt.Sprintf("^a{%d}$", i) }},
		{"rejected patterns", func(i int) string { return fmt.Sprintf("(a+)+%d", i) }},
		{"over-long patterns", func(i int) string { return fmt.Sprintf("%d%s", i, strings.Repeat("a", MaxPatternCodePoints)) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for i := 0; i < 4*maxCachedPatterns; i++ {
				pattern := tc.pattern(i)
				if got, want := AnalyzeCached(pattern), Analyze(pattern); !reflect.DeepEqual(got, want) {
					t.Fatalf("AnalyzeCached(%q) = %+v, want %+v", pattern, got, want)
				}
			}
			cacheMu.Lock()
			size := len(compiledCache)
			cacheMu.Unlock()
			if size > maxCachedPatterns {
				t.Fatalf("AnalyzeCached holds %d patterns, want at most %d", size, maxCachedPatterns)
			}
		})
	}
}
