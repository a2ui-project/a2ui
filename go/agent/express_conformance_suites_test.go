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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func expConfRunCaseWithManifest(t *testing.T, confRoot, suite, caseName, ver string, origCase map[string]any) {
	t.Helper()
	isLowered := ver == "v0.9-lowered"
	tc := origCase
	if isLowered {
		if skipReason := expConfV09SkipReason(t, confRoot, origCase); skipReason != "" {
			expConfManifest.record(suite, caseName, ver, "skipped", skipReason)
			t.Skip(skipReason)
		}
		tc = expConfLowerCase(t, confRoot, origCase)
	}

	var recorded bool
	defer func() {
		if !recorded {
			if t.Failed() {
				expConfManifest.record(suite, caseName, ver, "failed", "")
			} else if t.Skipped() {
				expConfManifest.record(suite, caseName, ver, "skipped", "skipped")
			} else {
				expConfManifest.record(suite, caseName, ver, "passed", "")
			}
		}
	}()

	switch suite {
	case "agent/express/compiler.yaml":
		expConfRunCompileCase(t, confRoot, tc, isLowered)
	case "agent/express/decompiler.yaml":
		expConfRunDecompileCase(t, confRoot, origCase, tc, isLowered)
	case "agent/express/prompt_generator.yaml":
		expConfRunPromptGeneratorCase(t, confRoot, tc, isLowered)
	case "agent/express/response_parser.yaml":
		expConfRunResponseParserCase(t, confRoot, tc, isLowered)
	case "agent/express/response_streaming.yaml":
		expConfRunResponseStreamingCase(t, confRoot, tc, isLowered)
	default:
		t.Fatalf("unhandled suite %s", suite)
	}
}

func expConfRunCompileCase(t *testing.T, confRoot string, tc map[string]any, isLowered bool) {
	t.Helper()
	if tc["action"] != "compile" {
		t.Fatalf("expected action=compile, got %v", tc["action"])
	}
	expConfAssertKnownKeys(t, tc, expConfCompileCaseKeys, "compile case")

	args, _ := tc["args"].(map[string]any)
	p := expConfMakeParser(t, confRoot, args)
	input, _ := tc["input"].(string)

	if expectErr, hasErr := tc["expect_error"]; hasErr {
		_, err := expConfCompileChecked(p, input)
		expConfAssertErrorMatches(t, err, expectErr)
		return
	}

	rawMsgs, err := expConfCompileChecked(p, input)
	if err != nil {
		t.Fatalf("compile failed: %v", err)
	}
	var compiled []any
	if isLowered {
		compiled = expConfLiftMessages(rawMsgs)
	} else {
		compiled = expConfMessagesToAnySlice(rawMsgs)
	}

	if presentList, ok := tc["expect_present"].([]any); ok {
		for _, ptrRaw := range presentList {
			ptr, _ := ptrRaw.(string)
			val := expConfResolvePointer(compiled, ptr)
			if val == nil || val == "" {
				t.Fatalf("expected non-empty value at pointer %q, got %v", ptr, val)
			}
			expConfDeletePointer(compiled, ptr)
		}
	}

	expConfAssertJSONEqual(t, compiled, tc["expect"], "compile output")
}

func expConfRunDecompileCase(t *testing.T, confRoot string, origCase, tc map[string]any, isLowered bool) {
	t.Helper()
	if tc["action"] != "decompile" {
		t.Fatalf("expected action=decompile, got %v", tc["action"])
	}
	expConfAssertKnownKeys(t, tc, expConfDecompileCaseKeys, "decompile case")

	args, _ := tc["args"].(map[string]any)
	p := expConfMakeParser(t, confRoot, args)
	messages := expConfToMessageSlice(tc["messages"])

	if expectErr, hasErr := tc["expect_error"]; hasErr {
		_, err := p.Decompile(messages)
		expConfAssertErrorMatches(t, err, expectErr)
		return
	}

	notation, err := p.Decompile(messages)
	if err != nil {
		t.Fatalf("Decompile failed: %v", err)
	}

	if contains, ok := tc["expect_contains"].([]any); ok {
		for _, fRaw := range contains {
			frag, _ := fRaw.(string)
			if !strings.Contains(notation, frag) {
				t.Fatalf("expected decompiled output to contain %q, got:\n%s", frag, notation)
			}
		}
	}
	if absent, ok := tc["expect_absent"].([]any); ok {
		for _, fRaw := range absent {
			frag, _ := fRaw.(string)
			if strings.Contains(notation, frag) {
				t.Fatalf("expected decompiled output NOT to contain %q, got:\n%s", frag, notation)
			}
		}
	}

	recompile := func() []any {
		recompiledMsgs, rErr := expConfCompileChecked(p, notation)
		if rErr != nil {
			t.Fatalf("recompiling decompiled notation failed: %v\nnotation:\n%s", rErr, notation)
		}
		if isLowered {
			return expConfLiftMessages(recompiledMsgs)
		}
		return expConfMessagesToAnySlice(recompiledMsgs)
	}

	if rt, _ := tc["expect_round_trip"].(bool); rt {
		expConfAssertJSONEqual(t, recompile(), origCase["messages"], "decompile round_trip")
	}
	if wantRecompiled, hasRecomp := tc["expect_recompiled"]; hasRecomp {
		expConfAssertJSONEqual(t, recompile(), wantRecompiled, "decompile expect_recompiled")
	}
}

func expConfRunPromptGeneratorCase(t *testing.T, confRoot string, tc map[string]any, isLowered bool) {
	t.Helper()
	if tc["action"] != "generate_prompt_snippet" {
		t.Fatalf("expected action=generate_prompt_snippet, got %v", tc["action"])
	}
	expConfAssertKnownKeys(t, tc, expConfGeneratePromptSnippetCaseKeys, "generate_prompt_snippet case")

	args, _ := tc["args"].(map[string]any)
	if expectErr, hasErr := tc["expect_error"]; hasErr {
		fmtInst, err := expConfMakeFormat(t, confRoot, args, false, isLowered)
		if err == nil {
			_, err = fmtInst.PromptGenerator().Generate()
		}
		expConfAssertErrorMatches(t, err, expectErr)
		return
	}

	fmtInst, err := expConfMakeFormat(t, confRoot, args, false, isLowered)
	if err != nil {
		t.Fatalf("expConfMakeFormat: %v", err)
	}
	snippet, err := fmtInst.PromptGenerator().Generate()
	if err != nil {
		t.Fatalf("PromptGenerator().Generate: %v", err)
	}

	if expectFile, ok := tc["expect_file"].(string); ok && expectFile != "" {
		wantBytes, rErr := os.ReadFile(filepath.Join(confRoot, filepath.FromSlash(expectFile)))
		if rErr != nil {
			t.Fatalf("ReadFile(%s): %v", expectFile, rErr)
		}
		if snippet != string(wantBytes) {
			t.Fatalf("snippet did not match %s", expectFile)
		}
	}
	if contains, ok := tc["expect_contains"].([]any); ok {
		for _, fRaw := range contains {
			frag, _ := fRaw.(string)
			if !strings.Contains(snippet, frag) {
				t.Fatalf("expected prompt snippet to contain %q, got:\n%s", frag, snippet)
			}
		}
	}
	if absent, ok := tc["expect_absent"].([]any); ok {
		for _, fRaw := range absent {
			frag, _ := fRaw.(string)
			if strings.Contains(snippet, frag) {
				t.Fatalf("expected prompt snippet NOT to contain %q, got:\n%s", frag, snippet)
			}
		}
	}
	if wantCallableRaw, hasCallable := tc["expect_callable_functions"]; hasCallable {
		wantCallable := expConfToStringSlice(wantCallableRaw.([]any))
		cats, cErr := expConfCatalogsFor(t, confRoot, args, false)
		if cErr != nil {
			t.Fatalf("expConfCatalogsFor: %v", cErr)
		}
		gotCallable := AgentCallableFunctions(cats)
		if !slices.Equal(gotCallable, wantCallable) {
			t.Fatalf("AgentCallableFunctions = %v, want %v", gotCallable, wantCallable)
		}
		for _, fnName := range wantCallable {
			if !strings.Contains(snippet, fnName) {
				t.Fatalf("expected callable function %q in snippet", fnName)
			}
		}
	}
	if det, _ := tc["expect_deterministic"].(bool); det {
		second, gErr := fmtInst.PromptGenerator().Generate()
		if gErr != nil {
			t.Fatalf("PromptGenerator().Generate second call: %v", gErr)
		}
		if snippet != second {
			t.Fatalf("prompt snippet is not deterministic across calls")
		}
	}
}

func expConfRunResponseParserCase(t *testing.T, confRoot string, tc map[string]any, isLowered bool) {
	t.Helper()
	args, _ := tc["args"].(map[string]any)
	p := expConfMakeParser(t, confRoot, args)
	action, _ := tc["action"].(string)

	switch action {
	case "unwrap":
		expConfAssertKnownKeys(t, tc, expConfUnwrapCaseKeys, "unwrap case")
		input, _ := tc["input"].(string)
		expected, _ := tc["expect"].([]any)
		rawParts := p.Unwrap(input)
		gotDicts := make([]any, len(rawParts))
		for i, rp := range rawParts {
			gotDicts[i] = expConfRawPartToDict(rp)
		}
		expConfAssertJSONEqual(t, gotDicts, expConfWithoutTrueFinalFlags(expected), "unwrap parts")

		hasAny := false
		hasComplete := false
		for _, eRaw := range expected {
			em, _ := eRaw.(map[string]any)
			if _, hasA2UI := em["a2ui_raw"]; hasA2UI {
				hasAny = true
				isFin := true
				if b, ok := em["is_final"].(bool); ok {
					isFin = b
				}
				if isFin {
					hasComplete = true
				}
			}
		}
		if got := p.HasFormatContent(input, false); got != hasAny {
			t.Fatalf("HasFormatContent(complete=false) = %v, want %v", got, hasAny)
		}
		if got := p.HasFormatContent(input, true); got != hasComplete {
			t.Fatalf("HasFormatContent(complete=true) = %v, want %v", got, hasComplete)
		}

	case "has_format_content":
		expConfAssertKnownKeys(t, tc, expConfHasFormatContentCaseKeys, "has_format_content case")
		input, _ := tc["input"].(string)
		complete, _ := args["complete"].(bool)
		want, _ := tc["expect"].(bool)
		if got := p.HasFormatContent(input, complete); got != want {
			t.Fatalf("HasFormatContent(complete=%v) = %v, want %v", complete, got, want)
		}

	case "wrap":
		expConfAssertKnownKeys(t, tc, expConfWrapCaseKeys, "wrap case")
		partsList, _ := tc["parts"].([]any)
		output := p.Wrap(expConfToRawParts(partsList))
		if wantOut, hasOut := tc["expect_output"].(string); hasOut && output != wantOut {
			t.Fatalf("Wrap output = %q, want %q", output, wantOut)
		}
		if contains, ok := tc["expect_contains"].([]any); ok {
			for _, fRaw := range contains {
				frag, _ := fRaw.(string)
				if !strings.Contains(output, frag) {
					t.Fatalf("expected Wrap output to contain %q, got %q", frag, output)
				}
			}
		}
		if rt, _ := tc["expect_round_trip"].(bool); rt {
			unwrapped := p.Unwrap(output)
			gotDicts := make([]any, len(unwrapped))
			for i, rp := range unwrapped {
				gotDicts[i] = expConfRawPartToDict(rp)
			}
			expConfAssertJSONEqual(t, gotDicts, expConfWithoutTrueFinalFlags(partsList), "wrap round_trip")
		}

	case "parse_response":
		expConfAssertKnownKeys(t, tc, expConfParseResponseCaseKeys, "parse_response case")
		input, _ := tc["input"].(string)
		var parseOpts *ParseOptions
		if wrappedVal, hasWrapped := args["wrapped"].(bool); hasWrapped && !wrappedVal {
			parseOpts = &ParseOptions{Unwrapped: true}
		}
		if expectErr, hasErr := tc["expect_error"]; hasErr {
			_, err := p.ParseResponse(input, parseOpts)
			expConfAssertErrorMatches(t, err, expectErr)
			return
		}
		parts, err := p.ParseResponse(input, parseOpts)
		if err != nil {
			t.Fatalf("ParseResponse failed: %v", err)
		}
		gotDicts := make([]any, len(parts))
		for i, rp := range parts {
			gotDicts[i] = expConfResponsePartToDict(rp)
		}
		if isLowered {
			gotDicts = expConfLiftParts(gotDicts)
		}
		expConfAssertJSONEqual(t, gotDicts, tc["expect"], "parse_response")

	default:
		t.Fatalf("unknown response_parser action %q", action)
	}
}

func expConfRunResponseStreamingCase(t *testing.T, confRoot string, tc map[string]any, isLowered bool) {
	t.Helper()
	if tc["action"] != "parse_chunk" {
		t.Fatalf("expected action=parse_chunk, got %v", tc["action"])
	}
	expConfAssertKnownKeys(t, tc, expConfParseChunkCaseKeys, "parse_chunk case")

	args, _ := tc["args"].(map[string]any)
	wrapped := true
	if w, ok := args["wrapped"].(bool); ok {
		wrapped = w
	}
	afterRejected := AfterRejectedEnd
	if ar, ok := args["after_rejected_block"].(string); ok && ar == "continue" {
		afterRejected = AfterRejectedContinue
	}

	p := expConfMakeParser(t, confRoot, args)
	stream, err := p.OpenStream(&StreamOptions{
		Unwrapped:          !wrapped,
		AfterRejectedBlock: afterRejected,
	})
	if err != nil {
		t.Fatalf("OpenStream failed: %v", err)
	}

	toExpectedStreamDicts := func(parts []StreamPart) []any {
		dicts := make([]any, len(parts))
		for i, sp := range parts {
			dicts[i] = expConfStreamPartToDict(sp)
		}
		if isLowered {
			return expConfLiftParts(dicts)
		}
		return dicts
	}
	toExpectedRespDicts := func(parts []ResponsePart) []any {
		dicts := make([]any, len(parts))
		for i, rp := range parts {
			dicts[i] = expConfResponsePartToDict(rp)
		}
		if isLowered {
			return expConfLiftParts(dicts)
		}
		return dicts
	}

	var chunks []string
	var yielded []any
	steps, _ := tc["steps"].([]any)

	for stepIdx, stepRaw := range steps {
		step, _ := stepRaw.(map[string]any)
		expConfAssertKnownKeys(t, step, expConfParseChunkStepKeys, "parse_chunk step")
		chunk, _ := step["input"].(string)
		chunks = append(chunks, chunk)

		if expectErr, hasErr := step["expect_error"]; hasErr {
			_, feedErr := stream.Feed(chunk)
			expConfAssertErrorMatches(t, feedErr, expectErr)
			if wantPartials, hasPartials := step["expect_partial_results"]; hasPartials {
				var partials []ResponsePart
				var carrier PartialResultsCarrier
				if errors.As(feedErr, &carrier) {
					partials = carrier.PartialResults()
				}
				expConfAssertJSONEqual(t, toExpectedRespDicts(partials), wantPartials, fmt.Sprintf("step %d partial_results", stepIdx))
			}
			if wantInBlock, hasInBlock := step["expect_in_block"].(bool); hasInBlock {
				if stream.IsInBlock() != wantInBlock {
					t.Fatalf("step %d IsInBlock() = %v, want %v", stepIdx, stream.IsInBlock(), wantInBlock)
				}
			}
			return
		}

		parts, feedErr := stream.Feed(chunk)
		if feedErr != nil {
			t.Fatalf("step %d Feed(%q) unexpected error: %v", stepIdx, chunk, feedErr)
		}
		stepDicts := toExpectedStreamDicts(parts)
		expConfAssertJSONEqual(t, stepDicts, step["expect"], fmt.Sprintf("step %d output", stepIdx))
		if wantInBlock, hasInBlock := step["expect_in_block"].(bool); hasInBlock {
			if stream.IsInBlock() != wantInBlock {
				t.Fatalf("step %d IsInBlock() = %v, want %v", stepIdx, stream.IsInBlock(), wantInBlock)
			}
		}
		yielded = append(yielded, stepDicts...)
	}

	if expectErr, hasErr := tc["expect_error"]; hasErr {
		_, closeErr := stream.Close()
		expConfAssertErrorMatches(t, closeErr, expectErr)
		return
	}

	closedParts, closeErr := stream.Close()
	if closeErr != nil {
		t.Fatalf("Close() unexpected error: %v", closeErr)
	}
	closedDicts := toExpectedStreamDicts(closedParts)
	if wantClose, hasClose := tc["expect_close"]; hasClose {
		expConfAssertJSONEqual(t, closedDicts, wantClose, "expect_close")
	}
	yielded = append(yielded, closedDicts...)

	if matchSingle, _ := tc["expect_matches_single_shot"].(bool); matchSingle {
		freshParser := expConfMakeParser(t, confRoot, args)
		singleParts, sErr := freshParser.ParseResponse(strings.Join(chunks, ""), &ParseOptions{
			Unwrapped: !wrapped,
		})
		if sErr != nil {
			t.Fatalf("single-shot ParseResponse failed: %v", sErr)
		}
		expConfAssertJSONEqual(
			t,
			expConfMergeTextParts(yielded),
			expConfMergeTextParts(toExpectedRespDicts(singleParts)),
			"expect_matches_single_shot",
		)
	}
}
