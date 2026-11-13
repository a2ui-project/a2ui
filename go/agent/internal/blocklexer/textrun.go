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

package blocklexer

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// TextRun emits conversational text between blocks during streaming, trimming leading
// whitespace at the start of a run and holding trailing whitespace until non-blank text
// follows in the same run.
type TextRun struct {
	started   bool
	heldSpace string
}

// Emit processes text as the next fragment of the current run and returns the string to emit
// alongside true when non-empty text became ready.
func (r *TextRun) Emit(text string) (string, bool) {
	trimmedStart := text
	if !r.started {
		trimmedStart = strings.TrimLeftFunc(text, unicode.IsSpace)
	}
	body := strings.TrimRightFunc(trimmedStart, unicode.IsSpace)
	if body == "" {
		if r.started {
			r.heldSpace += text
		}
		return "", false
	}
	out := r.heldSpace + body
	r.heldSpace = trimmedStart[len(body):]
	r.started = true
	return out, true
}

// Reset ends the current text run (for example when entering an A2UI block), dropping held trailing space.
func (r *TextRun) Reset() {
	r.started = false
	r.heldSpace = ""
}

// CompleteUTF8PrefixLen returns len(s) minus 1..3 trailing bytes when s ends
// with a valid, incomplete multi-byte UTF-8 rune prefix, or len(s) otherwise.
func CompleteUTF8PrefixLen(s string) int {
	n := len(s)
	for k := 1; k <= 3 && k <= n; k++ {
		b := s[n-k]
		if b < utf8.RuneSelf {
			return n
		}
		if utf8.RuneStart(b) {
			if !utf8.FullRuneInString(s[n-k:]) {
				return n - k
			}
			return n
		}
	}
	return n
}
