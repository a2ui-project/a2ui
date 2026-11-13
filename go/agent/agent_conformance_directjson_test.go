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

package agent_test

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// --- Scaling (Performance) ---

func writeScalingPayload(t *testing.T, segments []any, size int) string {
	t.Helper()
	var sb strings.Builder
	for _, seg := range segments {
		if s, ok := seg.(string); ok {
			sb.WriteString(s)
			continue
		}
		m, ok := seg.(map[string]any)
		if !ok {
			t.Fatalf("unexpected payload segment %T", seg)
		}
		tmpl, _ := m["repeat"].(string)
		sep, _ := m["separator"].(string)
		for i := 0; i < size; i++ {
			if i > 0 {
				sb.WriteString(sep)
			}
			sb.WriteString(strings.ReplaceAll(tmpl, "{i}", strconv.Itoa(i)))
		}
	}
	return sb.String()
}

func updatedBeforeCreatedMessages(payload string, defaultCatID string) []core.AgentToRendererMessage {
	parsed, err := core.ParseJSON([]byte(payload))
	if err != nil {
		return nil
	}
	var items []any
	if arr, ok := parsed.([]any); ok {
		items = arr
	} else {
		items = []any{parsed}
	}
	created := make(map[string]bool)
	var creates []core.AgentToRendererMessage
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		for k, v := range m {
			body, isMap := v.(map[string]any)
			if !isMap {
				continue
			}
			sid, hasSID := body["surfaceId"].(string)
			if !hasSID {
				continue
			}
			if k == "createSurface" {
				created[sid] = true
			} else if !created[sid] {
				created[sid] = true
				creates = append(creates, core.AgentToRendererMessage{
					"version": m["version"],
					"createSurface": map[string]any{
						"surfaceId": sid,
						"catalogId": defaultCatID,
					},
				})
			}
		}
	}
	return creates
}

func makeScalingCall(t *testing.T, fmtInst agent.InferenceFormat, op string, payload string, chunkSize int) func() {
	t.Helper()
	cats := fmtInst.CreateParser().Catalogs()
	if op == "compile" {
		return func() {
			if _, err := fmtInst.CreateParser().ParseResponse(payload, &agent.ParseOptions{Unwrapped: true}); err != nil {
				t.Fatalf("scaling compile ParseResponse failed: %v", err)
			}
		}
	}
	if op != "parse_chunk" {
		t.Fatalf("unknown scaling operation %q", op)
	}
	resp := "<a2ui-json>" + payload + "</a2ui-json>"
	var chunks []string
	for i := 0; i < len(resp); i += chunkSize {
		end := i + chunkSize
		if end > len(resp) {
			end = len(resp)
		}
		chunks = append(chunks, resp[i:end])
	}
	creates := updatedBeforeCreatedMessages(payload, cats[0].CatalogID())

	return func() {
		state, err := agent.NewRendererState(cats)
		if err != nil {
			t.Fatalf("NewRendererState failed: %v", err)
		}
		if len(creates) > 0 {
			if _, err := state.Apply(creates); err != nil {
				t.Fatalf("state.Apply(creates) failed: %v", err)
			}
		}
		stream, err := fmtInst.CreateParser().OpenStream(&agent.StreamOptions{State: state})
		if err != nil {
			t.Fatalf("OpenStream failed: %v", err)
		}
		for _, ch := range chunks[:len(chunks)-1] {
			if _, err := stream.Feed(ch); err != nil {
				t.Fatalf("scaling Feed failed: %v", err)
			}
		}
		_, lastErr := stream.Feed(chunks[len(chunks)-1])
		if lastErr == nil {
			_, lastErr = stream.Close()
		}
		if lastErr != nil && len(creates) == 0 {
			t.Fatalf("scaling stream close failed: %v", lastErr)
		}
	}
}

func prepareScalingCase(t *testing.T, confRoot string, tc loadedYAMLCase) (agent.InferenceFormat, func(string) func()) {
	t.Helper()
	args, _ := tc.Data["args"].(map[string]any)
	cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
	if err != nil {
		t.Fatalf("loadCatalogs failed: %v", err)
	}
	fmtName, _ := args["format"].(string)
	fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
	if err != nil {
		t.Fatalf("buildFormat failed: %v", err)
	}
	op, _ := tc.Data["operation"].(string)
	chunkSize, _ := intValue(tc.Data["chunk_size"])
	return fmtInst, func(payload string) func() {
		return makeScalingCall(t, fmtInst, op, payload, chunkSize)
	}
}

func expectTimeRatio(t *testing.T, measured, baseline func(), maxRatio float64, what string) {
	t.Helper()
	baseline()
	measured()
	const runs = 5
	baseTimes := make([]time.Duration, runs)
	measTimes := make([]time.Duration, runs)
	for i := 0; i < runs; i++ {
		runtime.GC()
		t0 := time.Now()
		baseline()
		baseTimes[i] = time.Since(t0)

		runtime.GC()
		t1 := time.Now()
		measured()
		measTimes[i] = time.Since(t1)
	}
	sort.Slice(baseTimes, func(i, j int) bool { return baseTimes[i] < baseTimes[j] })
	sort.Slice(measTimes, func(i, j int) bool { return measTimes[i] < measTimes[j] })
	baseMed := float64(baseTimes[runs/2].Nanoseconds())
	if baseMed < 1 {
		baseMed = 1
	}
	measMed := float64(measTimes[runs/2].Nanoseconds())
	ratio := measMed / baseMed
	if ratio > maxRatio {
		t.Fatalf("median time of %s: %.0f µs vs %.0f µs (ratio %.2f > max %.2f)", what, measMed/1000, baseMed/1000, ratio, maxRatio)
	}
}

func runScalingCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	segments, _ := tc.Data["payload"].([]any)
	maxRatio, ok := numberValue(tc.Data["max_ratio"])
	if !ok {
		t.Fatalf("max_ratio %#v is not a number", tc.Data["max_ratio"])
	}
	fmtInst, prepare := prepareScalingCase(t, confRoot, tc)
	if tc.Action == "measure_growth" {
		sizesRaw, _ := tc.Data["sizes"].([]any)
		if len(sizesRaw) != 2 {
			t.Fatalf("sizes %#v must be two numbers", tc.Data["sizes"])
		}
		small, okSmall := intValue(sizesRaw[0])
		large, okLarge := intValue(sizesRaw[1])
		if !okSmall || !okLarge {
			t.Fatalf("sizes %#v must be two numbers", sizesRaw)
		}
		expectTimeRatio(
			t,
			prepare(writeScalingPayload(t, segments, large)),
			prepare(writeScalingPayload(t, segments, small)),
			maxRatio,
			fmt.Sprintf("%s at %d vs %d", tc.Data["operation"], large, small),
		)
		return
	}
	size, ok := intValue(tc.Data["size"])
	if !ok {
		t.Fatalf("size %#v is not a number", tc.Data["size"])
	}
	payload := writeScalingPayload(t, segments, size)
	op, _ := tc.Data["operation"].(string)
	baseOp, _ := tc.Data["baseline"].(string)
	chunkSize, _ := intValue(tc.Data["chunk_size"])
	expectTimeRatio(
		t,
		makeScalingCall(t, fmtInst, op, payload, chunkSize),
		makeScalingCall(t, fmtInst, baseOp, payload, chunkSize),
		maxRatio,
		fmt.Sprintf("%s vs %s", op, baseOp),
	)
}

// --- E2E Golden-Transcript Conformance ---

func TestE2EConformance(t *testing.T) {
	repoRoot, confRoot := findRepoAndConformanceRoot(t)
	e2eDir := filepath.Join(confRoot, "e2e")
	var suites []string
	err := filepath.WalkDir(e2eDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".yaml") {
			rel, err := filepath.Rel(confRoot, path)
			if err != nil {
				return err
			}
			suites = append(suites, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("failed walking conformance/e2e: %v", err)
	}
	sort.Strings(suites)
	if len(suites) == 0 {
		t.Fatal("expected E2E suites under conformance/e2e")
	}

	var records []manifestRecord
	for _, suite := range suites {
		cases := loadYAMLCases(t, confRoot, suite)
		t.Run(suite, func(t *testing.T) {
			for _, tc := range cases {
				ok := t.Run(tc.Name, func(t *testing.T) {
					runE2EScenario(t, repoRoot, confRoot, tc)
				})
				status := "passed"
				if !ok {
					status = "failed"
				}
				records = append(records, manifestRecord{
					Harness: "go-agent",
					Suite:   suite,
					Case:    tc.Name,
					Status:  status,
				})
			}
		})
	}

	writeManifestRecords(t, "go-agent-e2e.jsonl", records)
}

func runE2EScenario(t *testing.T, repoRoot, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, makeSet("name", "action", "description", "protocolVersion", "catalogPaths", "formats", "source", "turns"), "e2e_scenario")
	if src, ok := tc.Data["source"].(map[string]any); ok {
		assertKnownKeys(t, src, makeSet("kind", "from", "model", "recordedAt"), "e2e_scenario.source")
	}
	protoVer, _ := tc.Data["protocolVersion"].(string)
	if protoVer == "" {
		protoVer = "1.0"
	}

	var catalogs []*core.Catalog
	for _, relPath := range toStringSlice(tc.Data["catalogPaths"]) {
		fullPath := filepath.Join(confRoot, filepath.FromSlash(relPath))
		if _, err := os.Stat(fullPath); err != nil {
			fullPath = filepath.Join(repoRoot, filepath.FromSlash(relPath))
		}
		docAny, _ := loadJSONFileWithOrder(t, fullPath)
		docMap, _ := docAny.(map[string]any)
		pv := ""
		if _, hasPV := docMap["protocolVersion"]; !hasPV {
			pv = protoVer
		}
		cid := ""
		if _, hasCID := docMap["catalogId"]; !hasCID {
			cid = strings.TrimSuffix(filepath.Base(relPath), ".json")
		}
		cfg, err := agent.CatalogConfigFromPath(fullPath, &agent.CatalogConfigOptions{
			CatalogID:       cid,
			ProtocolVersion: core.ProtocolVersion(pv),
		})
		if err != nil {
			t.Fatalf("CatalogConfigFromPath(%s) failed: %v", fullPath, err)
		}
		catalogs = append(catalogs, cfg.TransformedCatalog())
	}

	turns, _ := tc.Data["turns"].([]any)
	for tidx, rawTurn := range turns {
		tm, _ := rawTurn.(map[string]any)
		assertKnownKeys(t, tm, makeSet("userText", "modelChunks", "expectWire", "expectViewTree", "expectErrors", "uiOps", "expectDataModel", "expectOutbound"), fmt.Sprintf("turns[%d]", tidx))
		if ops, ok := tm["uiOps"].([]any); ok {
			for oidx, op := range ops {
				if om, ok2 := op.(map[string]any); ok2 {
					assertKnownKeys(t, om, makeSet("op", "surfaceId", "targetNode", "inputValue", "userActivation"), fmt.Sprintf("turns[%d].uiOps[%d]", tidx, oidx))
				}
			}
		}
	}

	for _, fmtName := range toStringSlice(tc.Data["formats"]) {
		fmtInst, err := buildFormatForCase(t, fmtName, catalogs, nil, nil, false)
		if err != nil {
			t.Fatalf("buildFormat(%s) failed: %v", fmtName, err)
		}
		parser := fmtInst.CreateParser()
		streamState, err := agent.NewRendererState(catalogs)
		if err != nil {
			t.Fatalf("NewRendererState failed: %v", err)
		}
		singleState, err := agent.NewRendererState(catalogs)
		if err != nil {
			t.Fatalf("NewRendererState failed: %v", err)
		}

		for tidx, rawTurn := range turns {
			tm, _ := rawTurn.(map[string]any)
			modelChunks, _ := tm["modelChunks"].(map[string]any)
			chunks := toStringSlice(modelChunks[fmtName])
			expectedWire, _ := tm["expectWire"].([]any)

			createdInTurn := make(map[string]bool)
			for _, wp := range expectedWire {
				wpm, _ := wp.(map[string]any)
				if a2uiList, ok := wpm["a2ui"].([]any); ok {
					for _, rawMsg := range a2uiList {
						mm, _ := rawMsg.(map[string]any)
						if cs, ok2 := mm["createSurface"].(map[string]any); ok2 {
							if sid, ok3 := cs["surfaceId"].(string); ok3 {
								createdInTurn[sid] = true
							}
						}
					}
				}
			}
			for _, wp := range expectedWire {
				wpm, _ := wp.(map[string]any)
				if a2uiList, ok := wpm["a2ui"].([]any); ok {
					for _, rawMsg := range a2uiList {
						mm, _ := rawMsg.(map[string]any)
						if uc, ok2 := mm["updateComponents"].(map[string]any); ok2 {
							sid, _ := uc["surfaceId"].(string)
							if sid == "" || createdInTurn[sid] {
								continue
							}
							createMsg := core.AgentToRendererMessage{
								"version": protoVer,
								"createSurface": map[string]any{
									"surfaceId": sid,
									"catalogId": catalogs[0].CatalogID(),
								},
							}
							if streamState.Surface(sid) == nil {
								_, _ = streamState.Apply([]core.AgentToRendererMessage{createMsg})
							}
							if singleState.Surface(sid) == nil {
								_, _ = singleState.Apply([]core.AgentToRendererMessage{createMsg})
							}
						}
					}
				}
			}

			stream, err := parser.OpenStream(&agent.StreamOptions{State: streamState})
			if err != nil {
				t.Fatalf("[%s] turn %d OpenStream failed: %v", fmtName, tidx, err)
			}
			var streamedDicts []map[string]any
			for _, ch := range chunks {
				sp, feedErr := stream.Feed(ch)
				for _, p := range sp {
					streamedDicts = append(streamedDicts, streamPartToDict(p))
				}
				if feedErr != nil {
					streamedDicts = append(streamedDicts, map[string]any{
						"error": map[string]any{"category": errorCategoryOf(feedErr)},
					})
					break
				}
			}
			closedParts, closeErr := stream.Close()
			for _, p := range closedParts {
				streamedDicts = append(streamedDicts, streamPartToDict(p))
			}
			if closeErr != nil {
				streamedDicts = append(streamedDicts, map[string]any{
					"error": map[string]any{"category": errorCategoryOf(closeErr)},
				})
			}
			assertJSONEqual(t, mergeTextPartDicts(streamedDicts), expectedWire, fmt.Sprintf("[%s] turn %d streaming", fmtName, tidx))

			singleParts, singleErr := parser.ParseResponse(strings.Join(chunks, ""), &agent.ParseOptions{State: singleState})
			var singleDicts []map[string]any
			for _, p := range singleParts {
				singleDicts = append(singleDicts, responsePartToDict(p))
			}
			if singleErr != nil {
				for _, p := range extractPartialResults(singleErr) {
					singleDicts = append(singleDicts, responsePartToDict(p))
				}
				singleDicts = append(singleDicts, map[string]any{
					"error": map[string]any{"category": errorCategoryOf(singleErr)},
				})
			}
			assertJSONEqual(t, mergeTextPartDicts(singleDicts), expectedWire, fmt.Sprintf("[%s] turn %d single-shot", fmtName, tidx))
		}
	}
}

// --- Specification Examples Round-Trip (catalogs/basic/v1/examples/*.json) ---

func TestSpecificationExamplesRoundTrip(t *testing.T) {
	repoRoot, _ := findRepoAndConformanceRoot(t)
	pattern := filepath.Join(repoRoot, "catalogs", "basic", "v1", "examples", "*.json")
	files, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("Glob failed: %v", err)
	}
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatalf("no specification examples found at %s", pattern)
	}

	basicCat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog(1.0) failed: %v", err)
	}
	djFmt, err := agent.NewDirectJSONFormat([]*core.Catalog{basicCat}, nil, nil)
	if err != nil {
		t.Fatalf("NewDirectJSONFormat failed: %v", err)
	}
	expFmt, err := agent.NewExpressFormat([]*core.Catalog{basicCat}, nil, nil)
	if err != nil {
		t.Fatalf("NewExpressFormat failed: %v", err)
	}

	for _, file := range files {
		base := filepath.Base(file)
		t.Run(base, func(t *testing.T) {
			rawBytes, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("ReadFile failed: %v", err)
			}
			parsed, err := core.ParseJSON(rawBytes)
			if err != nil {
				t.Fatalf("ParseJSON failed: %v", err)
			}
			data, ok := parsed.(map[string]any)
			if !ok {
				t.Fatalf("%s is not a JSON object", base)
			}
			if cc, hasCustom := data["customComponents"].([]any); hasCustom && len(cc) > 0 {
				t.Skipf("%s uses customComponents not in BasicCatalog", base)
			}

			var messages []any
			if msgs, ok := data["messages"].([]any); ok {
				messages = msgs
			} else {
				messages = []any{data}
			}

			compsByID := make(map[string]map[string]any)
			var compOrder []string
			surfaceID := "main"
			for _, rawMsg := range messages {
				mm, ok := rawMsg.(map[string]any)
				if !ok {
					continue
				}
				if cs, ok2 := mm["createSurface"].(map[string]any); ok2 {
					if sid, ok3 := cs["surfaceId"].(string); ok3 && sid != "" {
						surfaceID = sid
					}
					if comps, ok3 := cs["components"].([]any); ok3 {
						for _, rc := range comps {
							if cm, ok4 := rc.(map[string]any); ok4 {
								if cid, ok5 := cm["id"].(string); ok5 {
									if _, seen := compsByID[cid]; !seen {
										compOrder = append(compOrder, cid)
									}
									compsByID[cid] = cm
								}
							}
						}
					}
				}
				if uc, ok2 := mm["updateComponents"].(map[string]any); ok2 {
					if comps, ok3 := uc["components"].([]any); ok3 {
						for _, rc := range comps {
							if cm, ok4 := rc.(map[string]any); ok4 {
								if cid, ok5 := cm["id"].(string); ok5 {
									if _, seen := compsByID[cid]; !seen {
										compOrder = append(compOrder, cid)
									}
									compsByID[cid] = cm
								}
							}
						}
					}
				}
			}

			reachable := reachableExampleComponents(compsByID, compOrder)
			if len(reachable) == 0 {
				t.Skipf("no components in %s", base)
			}

			surfacePayload := []core.AgentToRendererMessage{
				{
					"version": "1.0",
					"createSurface": map[string]any{
						"surfaceId":  surfaceID,
						"catalogId":  basicCat.CatalogID(),
						"components": reachable,
					},
				},
			}

			// 1. Direct JSON round-trip
			djParser := djFmt.CreateParser()
			djText, err := djParser.Decompile(surfacePayload)
			if err != nil {
				t.Fatalf("DirectJSON Decompile failed: %v", err)
			}
			djRecompiled, err := djParser.Compile(djText, true)
			if err != nil {
				t.Fatalf("DirectJSON Compile failed: %v", err)
			}
			assertRecompiledMatchesExample(t, "direct_json", djRecompiled, surfaceID, reachable)

			// 2. Express round-trip
			expParser := expFmt.CreateParser()
			expText, err := expParser.Decompile(surfacePayload)
			if err != nil {
				t.Fatalf("Express Decompile failed on %s: %v", base, err)
			}
			expRecompiled, err := expParser.Compile(expText, true)
			if err != nil {
				t.Fatalf("Express Compile failed on %s: %v\ndsl:\n%s", base, err, expText)
			}
			assertRecompiledMatchesExample(t, "express", expRecompiled, surfaceID, reachable)
		})
	}
}

func reachableExampleComponents(byID map[string]map[string]any, order []string) []any {
	if _, hasRoot := byID["root"]; !hasRoot {
		out := make([]any, 0, len(order))
		for _, id := range order {
			out = append(out, byID[id])
		}
		return out
	}

	var collectRefs func(v any) []string
	collectRefs = func(v any) []string {
		switch x := v.(type) {
		case string:
			if _, ok := byID[x]; ok {
				return []string{x}
			}
		case map[string]any:
			var out []string
			for _, item := range x {
				out = append(out, collectRefs(item)...)
			}
			return out
		case []any:
			var out []string
			for _, item := range x {
				out = append(out, collectRefs(item)...)
			}
			return out
		}
		return nil
	}

	reached := make(map[string]bool)
	pending := []string{"root"}
	for len(pending) > 0 {
		cid := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if reached[cid] {
			continue
		}
		reached[cid] = true
		comp := byID[cid]
		for k, v := range comp {
			if k != "id" {
				pending = append(pending, collectRefs(v)...)
			}
		}
	}

	out := make([]any, 0, len(reached))
	for _, id := range order {
		if reached[id] {
			out = append(out, byID[id])
		}
	}
	return out
}

func assertRecompiledMatchesExample(
	t *testing.T,
	formatName string,
	recompiled []core.AgentToRendererMessage,
	expectedSurfaceID string,
	expectedComponents []any,
) {
	t.Helper()
	if len(recompiled) == 0 {
		t.Fatalf("[%s] recompiled payload is empty", formatName)
	}
	var comps []map[string]any
	var foundSurfaceID string
	for _, msg := range recompiled {
		if cs, ok := msg["createSurface"].(map[string]any); ok {
			if sid, ok2 := cs["surfaceId"].(string); ok2 {
				foundSurfaceID = sid
			}
			if list, ok2 := cs["components"].([]any); ok2 {
				for _, item := range list {
					if cm, ok3 := item.(map[string]any); ok3 {
						comps = append(comps, cm)
					}
				}
			}
		}
		if uc, ok := msg["updateComponents"].(map[string]any); ok {
			if sid, ok2 := uc["surfaceId"].(string); ok2 {
				foundSurfaceID = sid
			}
			if list, ok2 := uc["components"].([]any); ok2 {
				for _, item := range list {
					if cm, ok3 := item.(map[string]any); ok3 {
						comps = append(comps, cm)
					}
				}
			}
		}
	}
	if foundSurfaceID != "" && foundSurfaceID != "main" && foundSurfaceID != expectedSurfaceID {
		t.Fatalf("[%s] surfaceId = %q, want %q", formatName, foundSurfaceID, expectedSurfaceID)
	}
	if len(comps) == 0 {
		t.Fatalf("[%s] recompiled payload contains 0 components", formatName)
	}
	expectedHasRoot := false
	for _, ec := range expectedComponents {
		if em, ok := ec.(map[string]any); ok && em["id"] == "root" {
			expectedHasRoot = true
		}
	}
	gotHasRoot := false
	for _, c := range comps {
		if c["id"] == "root" {
			gotHasRoot = true
		}
		if _, hasComp := c["component"]; !hasComp && len(c) <= 1 {
			t.Fatalf("[%s] component missing type/properties: %#v", formatName, c)
		}
	}
	if expectedHasRoot && !gotHasRoot {
		t.Fatalf("[%s] expected 'root' component in recompiled output", formatName)
	}
}
