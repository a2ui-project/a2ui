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

package agent

import (
	"strings"
	"testing"
)

// The expected outputs below are what PyYAML's yaml.dump(..., sort_keys=False) writes.
func TestMarshalFrontmatterMatchesPyYAML(t *testing.T) {
	tests := []struct {
		name        string
		skillName   string
		description string
		metadata    map[string]any
		want        string
	}{
		{
			name:        "folds long plain scalars at 80 columns",
			skillName:   "a2ui-basic",
			description: "UI component catalog signatures for basic. Use when building basic user interface components.",
			want:        "name: a2ui-basic\ndescription: UI component catalog signatures for basic. Use when building basic user\n  interface components.",
		},
		{
			name:        "quotes strings that resolve to booleans",
			skillName:   "yes",
			description: "true",
			want:        "name: 'yes'\ndescription: 'true'",
		},
		{
			name:        "quotes strings that resolve to numbers",
			skillName:   "123",
			description: "1.5",
			want:        "name: '123'\ndescription: '1.5'",
		},
		{
			name:        "quotes the empty string",
			skillName:   "x",
			description: "",
			want:        "name: x\ndescription: ''",
		},
		{
			name:        "quotes leading spaces",
			skillName:   "x",
			description: " padded",
			want:        "name: x\ndescription: ' padded'",
		},
		{
			name:        "quotes a colon followed by a space",
			skillName:   "x",
			description: "key: value and more",
			want:        "name: x\ndescription: 'key: value and more'",
		},
		{
			name:        "quotes a comment marker",
			skillName:   "x",
			description: "has #comment",
			want:        "name: x\ndescription: 'has #comment'",
		},
		{
			name:        "escapes non-ASCII characters in double quotes",
			skillName:   "x",
			description: "caf\u00e9 \u2014 r\u00e9sum\u00e9",
			want:        "name: x\ndescription: \"caf\\xE9 \\u2014 r\\xE9sum\\xE9\"",
		},
		{
			name:        "keeps an inner apostrophe plain",
			skillName:   "x",
			description: "it's fine",
			want:        "name: x\ndescription: it's fine",
		},
		{
			name:        "doubles apostrophes in single quotes",
			skillName:   "x",
			description: "'quoted' start",
			want:        "name: x\ndescription: '''quoted'' start'",
		},
		{
			name:        "writes line breaks in single quotes",
			skillName:   "x",
			description: "line one\nline two",
			want:        "name: x\ndescription: 'line one\n\n  line two'",
		},
		{
			name:        "folds long single-quoted scalars",
			skillName:   "x",
			description: "'" + strings.Repeat("word ", 30) + "end",
			want: "name: x\ndescription: '''word word word word word word word word word word word word word word\n" +
				"  word word word word word word word word word word word word word word word word\n  end'",
		},
		{
			name:        "folds long double-quoted scalars",
			skillName:   "x",
			description: "caf\u00e9 " + strings.Repeat("word ", 30) + "end",
			want: "name: x\ndescription: \"caf\\xE9 word word word word word word word word word word word word\\\n" +
				"  \\ word word word word word word word word word word word word word word word word\\\n  \\ word word end\"",
		},
		{
			name:        "quotes a leading dash followed by a space",
			skillName:   "- x",
			description: "-y",
			want:        "name: '- x'\ndescription: -y",
		},
		{
			name:        "writes metadata as nested block collections",
			skillName:   "x",
			description: "d",
			metadata: map[string]any{
				"b": []any{int64(1), "two", true, nil},
				"a": map[string]any{"nested": 1.5, "flag": false},
				"c": []any{},
				"d": map[string]any{},
			},
			want: "name: x\ndescription: d\nmetadata:\n  a:\n    flag: false\n    nested: 1.5\n  b:\n  - 1\n  - two\n  - true\n  - null\n  c: []\n  d: {}",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			entries := []frontmatterEntry{
				{key: "name", value: tc.skillName},
				{key: "description", value: tc.description},
			}
			if tc.metadata != nil {
				entries = append(entries, frontmatterEntry{key: "metadata", value: tc.metadata})
			}
			got := strings.TrimSpace(marshalFrontmatter(entries))
			if got != tc.want {
				t.Fatalf("marshalFrontmatter mismatch:\ngot:\n%s\nwant:\n%s", got, tc.want)
			}
		})
	}
}

func TestFormatFrontmatterFloatMatchesPythonRepr(t *testing.T) {
	tests := map[float64]string{
		1500:    "1500.0",
		1.5:     "1.5",
		0:       "0.0",
		1e16:    "1.0e+16",
		1.5e-07: "1.5e-07",
		0.0001:  "0.0001",
	}
	for in, want := range tests {
		if got := formatFrontmatterFloat(in); got != want {
			t.Errorf("formatFrontmatterFloat(%v) = %q, want %q", in, got, want)
		}
	}
}
