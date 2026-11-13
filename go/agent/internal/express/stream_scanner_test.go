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

package express

import (
	"strings"
	"testing"
	"time"
)

func TestScanExpressBlockFromLineCommentPartialCloseTag(t *testing.T) {
	inputs := []string{
		"surface(\"s1\")\nroot = Text(\"Hello\") # comment <\"000000<\n</a2ui> tail",
		"surface(\"s1\")\nroot = Text(\"Hello\") // comment </a2 \"unterminated\nroot2 = Text(\"ok\")</a2ui>",
		"surface(\"s1\")\nroot = Text(\"Hello\") -- comment < </a2u </a2ui> after",
	}
	for _, src := range inputs {
		scanPos := 0
		for end := 1; end <= len(src); end++ {
			prefix := src[:end]
			closeStart, hasClose, readable, next := ScanExpressBlockFrom(prefix, scanPos)
			fStart, fHas, fReadable, _ := ScanExpressBlockFrom(prefix, 0)
			if closeStart != fStart || hasClose != fHas || readable != fReadable {
				t.Fatalf("end=%d incremental ScanExpressBlockFrom(%q, %d) = (%d, %v, %d), fresh = (%d, %v, %d)",
					end, prefix, scanPos, closeStart, hasClose, readable, fStart, fHas, fReadable)
			}
			if next < scanPos || next > end {
				t.Fatalf("end=%d out-of-range resumePos %d (scanPos=%d)", end, next, scanPos)
			}
			scanPos = next
			if hasClose {
				break
			}
		}
	}
}

func TestStripTrailingFenceMatchesRegexp(t *testing.T) {
	cases := []string{
		"",
		" \t\r\n\f",
		"root = Text(\"hi\")",
		"root = Text(\"hi\")\n",
		"root = Text(\"hi\")   \r\n",
		"root = Text(\"hi\")`",
		"root = Text(\"hi\")``  \n",
		"root = Text(\"hi\")```",
		"root = Text(\"hi\")\n```",
		"root = Text(\"hi\")\r\n  \t```a2ui_dsl-1  \r\n",
		"root = Text(\"hi\")\n\n  ```express\n",
		"root = Text(\"hi\")````",
		"root = Text(\"hi\")````lang",
		"root = Text(\"hi\")``notafence",
		"root = Text(\"`inline`\")\nnext = Text(\"ok\")",
		"root = Text(\"`inline`\")\n```",
		"```",
		"\r\n\t ```\f ",
		"`",
		"abc_123-def",
		"```only_lang",
	}
	for _, s := range cases {
		got := stripTrailingFence(s)
		want := replaceFirst(trailingFenceRe, s, "")
		if got != want {
			t.Errorf("stripTrailingFence(%q) = %q, want %q", s, got, want)
		}
	}
}

func TestCleanExpressPayloadLinearInBufferLength(t *testing.T) {
	var b strings.Builder
	b.WriteString("```a2ui\nsurface(\"bench\")\n")
	for i := range 1000 {
		b.WriteString("c_")
		b.WriteByte(byte('a' + (i % 26)))
		b.WriteString(" = Text(\"hello `quoted` world\")\n")
	}
	b.WriteString("```\n")
	block := b.String()

	start := time.Now()
	for end := 16; end <= len(block); end += 16 {
		_, _ = CleanExpressPayload(block, end)
	}
	_, _ = CleanExpressPayload(block, len(block))
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("CleanExpressPayload over %d bytes in 16B steps took %v, expected near-instant O(N)", len(block), elapsed)
	}
}
