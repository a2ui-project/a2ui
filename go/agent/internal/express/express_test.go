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
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

func loadTestCatalog(t *testing.T, relPath string) *core.Catalog {
	t.Helper()
	fullPath := filepath.Join("..", "..", "..", "..", "conformance", relPath)
	raw, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", fullPath, err)
	}
	ko, err := schemahelper.ExtractJSONKeyOrder(raw)
	if err != nil {
		t.Fatalf("ExtractJSONKeyOrder(%s): %v", fullPath, err)
	}
	cat, err := core.CatalogFromJSONBytes(raw, &core.CatalogLoadOptions{KeyOrder: ko})
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes(%s): %v", fullPath, err)
	}
	return cat
}

func TestDecompileNumberECMAScriptNotation(t *testing.T) {
	negZero := math.Copysign(0.0, -1.0)
	cases := []struct {
		in   any
		want string
	}{
		{int64(42), "42"},
		{float64(3.0), "3.0"},
		{json.Number("1500.0"), "1500.0"},
		{json.Number("75"), "75"},
		{negZero, "-0.0"},
		{float64(2.5e-7), "2.5e-7"},
		{float64(1.5e+21), "1.5e+21"},
		{float64(0.000001), "0.000001"},
		{float64(123456.789), "123456.789"},
		{int64(9007199254740991), "9007199254740991"},
	}
	for _, tc := range cases {
		got, err := DecompileNumber(tc.in)
		if err != nil {
			t.Fatalf("DecompileNumber(%v) error: %v", tc.in, err)
		}
		if got != tc.want {
			t.Errorf("DecompileNumber(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestCompileAndDecompileRoundTrip(t *testing.T) {
	cat := loadTestCatalog(t, "test_data/catalogs/simplified_catalog_v1_0.json")
	compiler, err := NewCompiler([]*core.Catalog{cat}, "")
	if err != nil {
		t.Fatalf("NewCompiler: %v", err)
	}
	decompiler, err := NewDecompiler([]*core.Catalog{cat}, "")
	if err != nil {
		t.Fatalf("NewDecompiler: %v", err)
	}

	src := `surface("s1")
$/user/name = "Ada"
btnText = Text("Save")
root = Button(btnText, Event("save", {name: $/user/name}, userMessage="Saving"))`

	msgs, err := compiler.Compile(src, "main", true, "")
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 createSurface message, got %d", len(msgs))
	}
	dsl, err := decompiler.Decompile(msgs, false)
	if err != nil {
		t.Fatalf("Decompile: %v", err)
	}
	if !strings.Contains(dsl, `surface("s1")`) || !strings.Contains(dsl, `Event("save"`) {
		t.Fatalf("unexpected decompiled output:\n%s", dsl)
	}
	recompiled, err := compiler.Compile(dsl, "main", true, "")
	if err != nil {
		t.Fatalf("recompile: %v", err)
	}
	if len(recompiled) != 1 {
		t.Fatalf("expected 1 recompiled message, got %d", len(recompiled))
	}
}

func TestPromptGeneratorAndProgressiveHeal(t *testing.T) {
	cat := loadTestCatalog(t, "test_data/catalogs/simplified_catalog_v1_0.json")
	pg, err := NewPromptGenerator([]*core.Catalog{cat}, PromptGeneratorOptions{})
	if err != nil {
		t.Fatalf("NewPromptGenerator: %v", err)
	}
	prompt, err := pg.Generate(GenerateOptions{IncludeSchema: true})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	for _, want := range []string{"<a2ui>", "</a2ui>", "@index(offset?)", "Text(", "Button("} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q", want)
		}
	}

	compiler, err := NewCompiler([]*core.Catalog{cat}, "")
	if err != nil {
		t.Fatalf("NewCompiler: %v", err)
	}
	healed, ok := HealProgressiveFragment(
		`root = Text("Hello wor`,
		compiler.Helpers,
		compiler.CatalogOrder,
		map[string]bool{"text": true},
	)
	if !ok || healed != `root = Text("Hello wor")` {
		t.Fatalf("HealProgressiveFragment = (%q, %v), want (%q, true)", healed, ok, `root = Text("Hello wor")`)
	}
}
