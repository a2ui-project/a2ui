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

package schemaengine

import (
	"fmt"
	"testing"
)

func TestCompileECMARegexpCacheIsBounded(t *testing.T) {
	for i := 0; i < 4*maxCachedRegexps; i++ {
		pattern := fmt.Sprintf("^x%d$", i)
		re, err := CompileECMARegexp(pattern)
		if err != nil {
			t.Fatalf("CompileECMARegexp(%q): %v", pattern, err)
		}
		if value := fmt.Sprintf("x%d", i); !re.MatchString(value) {
			t.Fatalf("CompileECMARegexp(%q) does not match %q", pattern, value)
		}
	}
	regexpCacheMu.Lock()
	size := len(compiledRegexpCache)
	regexpCacheMu.Unlock()
	if size > maxCachedRegexps {
		t.Fatalf("compiled regexp cache holds %d patterns, want at most %d", size, maxCachedRegexps)
	}
}
