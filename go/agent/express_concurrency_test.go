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
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

func TestExpressParserConcurrentSafety(t *testing.T) {
	confRoot := expConfFindRoot(t)
	cat, err := expConfSetupCatalog(t, confRoot, expConfDefaultCatalog)
	if err != nil {
		t.Fatalf("expConfSetupCatalog: %v", err)
	}
	fmtInst, err := NewExpressFormat([]*core.Catalog{cat}, nil, nil)
	if err != nil {
		t.Fatalf("NewExpressFormat: %v", err)
	}
	sharedParser := fmtInst.CreateParser()
	sharedPrompt := fmtInst.PromptGenerator()

	var wg sync.WaitGroup
	for g := range 8 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			if s, gErr := sharedPrompt.Generate(); gErr != nil || !strings.Contains(s, "<a2ui>") {
				t.Errorf("goroutine %d prompt missing <a2ui> (err=%v)", id, gErr)
			}
			resp := fmt.Sprintf("Here:\n<a2ui>\nsurface(\"s_%d\")\nroot = Text(\"Hello %d\")\n</a2ui>", id, id)
			parts, pErr := sharedParser.ParseResponse(resp, nil)
			if pErr != nil || len(parts) != 2 {
				t.Errorf("goroutine %d ParseResponse: len=%d err=%v", id, len(parts), pErr)
				return
			}
			dsl, dErr := sharedParser.Decompile(parts[1].A2UI)
			if dErr != nil || !strings.Contains(dsl, "Text(") {
				t.Errorf("goroutine %d Decompile: %q err=%v", id, dsl, dErr)
			}
			st, sErr := sharedParser.OpenStream(nil)
			if sErr != nil {
				t.Errorf("goroutine %d OpenStream: %v", id, sErr)
				return
			}
			for _, ch := range []string{"<a2ui>\n", `root = Text("Hi`, ` there")` + "\n</a2ui>"} {
				if _, fErr := st.Feed(ch); fErr != nil {
					t.Errorf("goroutine %d Feed: %v", id, fErr)
					return
				}
			}
			if _, cErr := st.Close(); cErr != nil {
				t.Errorf("goroutine %d Close: %v", id, cErr)
			}
		}(g)
	}
	wg.Wait()
}
