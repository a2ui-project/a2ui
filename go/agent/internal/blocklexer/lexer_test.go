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

package blocklexer_test

import (
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/internal/blocklexer"
)

func TestBlockLexerStandardAndStrings(t *testing.T) {
	lex := blocklexer.MustNew(&blocklexer.Options{
		BlockComments: []blocklexer.BlockCommentPair{{Open: "/*", Close: "*/"}},
	})

	parts := lex.Tokenize("Preamble\n<a2ui>\ncode_here\n</a2ui>\nPostamble")
	if len(parts) != 3 || parts[0].Text != "Preamble" || parts[1].A2UIRaw != "code_here" || !parts[1].IsFinal || parts[2].Text != "Postamble" {
		t.Fatalf("unexpected parts: %+v", parts)
	}

	embedded := lex.Tokenize("Preamble\n<a2ui>\ntext = \"Hello </a2ui> World\"\n</a2ui>")
	if len(embedded) != 2 || embedded[1].A2UIRaw != `text = "Hello </a2ui> World"` {
		t.Fatalf("unexpected embedded string parts: %+v", embedded)
	}

	triple := lex.Tokenize("Preamble\n<a2ui>\ntext = \"\"\"\nLine 1\n</a2ui>\nLine 2\n\"\"\"\n</a2ui>")
	if len(triple) != 2 || triple[1].A2UIRaw != "text = \"\"\"\nLine 1\n</a2ui>\nLine 2\n\"\"\"" {
		t.Fatalf("unexpected triple string parts: %+v", triple)
	}

	blockComm := lex.Tokenize("Hi\n<a2ui>\n/* ignore </a2ui> here */\nx = 1\n</a2ui>")
	if len(blockComm) != 2 || blockComm[1].A2UIRaw != "/* ignore </a2ui> here */\nx = 1" {
		t.Fatalf("unexpected block comment parts: %+v", blockComm)
	}

	trunc := lex.Tokenize("Preamble\n<a2ui>\ntext = \"Hello")
	if len(trunc) != 2 || trunc[1].IsFinal || trunc[1].A2UIRaw != `text = "Hello` {
		t.Fatalf("unexpected truncated parts: %+v", trunc)
	}
}

func TestBlockLexerMarkdownAndMissingOpenTagRecovery(t *testing.T) {
	lex := blocklexer.MustNew(nil)

	md := lex.Tokenize("Preamble\n```html\n<a2ui>\ncode_here\n</a2ui>\n```\nPostamble")
	if len(md) != 3 || md[0].Text != "Preamble" || md[1].A2UIRaw != "code_here" || md[2].Text != "Postamble" {
		t.Fatalf("unexpected markdown parts: %+v", md)
	}

	fenced := lex.Tokenize("Preamble\n```a2ui\nsurface(\"main\")\nroot = Text(\"Hi\")\n</a2ui>\n```\nPostamble")
	if len(fenced) != 3 || fenced[0].Text != "Preamble" || fenced[1].A2UIRaw != "surface(\"main\")\nroot = Text(\"Hi\")" || fenced[2].Text != "Postamble" {
		t.Fatalf("unexpected fenced recovery parts: %+v", fenced)
	}

	unfenced := lex.Tokenize("Here is the UI.\nsurface(\"main\")\nroot = Text(\"Hi\")\n</a2ui>")
	if len(unfenced) != 2 || unfenced[0].Text != "Here is the UI." || unfenced[1].A2UIRaw != "surface(\"main\")\nroot = Text(\"Hi\")" {
		t.Fatalf("unexpected unfenced recovery parts: %+v", unfenced)
	}

	if _, err := blocklexer.New(&blocklexer.Options{
		BlockComments: []blocklexer.BlockCommentPair{{Open: "", Close: "*/"}},
	}); err == nil {
		t.Fatalf("expected error for empty block comment marker")
	}
}

func TestTextRun(t *testing.T) {
	var run blocklexer.TextRun
	if out, ok := run.Emit("   "); ok || out != "" {
		t.Fatalf("expected blank start to emit nothing, got %q (%v)", out, ok)
	}
	if out, ok := run.Emit("  Here "); !ok || out != "Here" {
		t.Fatalf("expected 'Here', got %q (%v)", out, ok)
	}
	if out, ok := run.Emit("it is: "); !ok || out != " it is:" {
		t.Fatalf("expected ' it is:', got %q (%v)", out, ok)
	}
	run.Reset()
	if out, ok := run.Emit("  and "); !ok || out != "and" {
		t.Fatalf("expected 'and' after reset, got %q (%v)", out, ok)
	}
}
