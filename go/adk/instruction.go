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

package adk

import (
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"unicode"

	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/session"
)

var statePlaceholderRe = regexp.MustCompile(`\{+[^{}]*\}+`)

// InstructionFunc matches google.golang.org/adk/v2/agent/llmagent.InstructionProvider.
type InstructionFunc = func(ctx adkagent.ReadonlyContext) (string, error)

// InstructionConfig configures InstructionProvider. The zero value of each field is the default.
type InstructionConfig struct {
	// Instruction is the agent's base instruction template. Its {key} placeholders
	// are read from session state, as ADK does for LlmAgent instructions.
	Instruction string
	// BaseProvider, when set, replaces Instruction and is called without template substitution.
	BaseProvider InstructionFunc

	// FallbackInstruction is the template used when A2UI is disabled for a context.
	// When both it and FallbackProvider are unset, the base instruction is used.
	FallbackInstruction string
	// FallbackProvider, when set, replaces FallbackInstruction.
	FallbackProvider InstructionFunc

	// ProcessorProvider resolves the context's RequestProcessor (for example, ProcessorStore.Get).
	// It is required unless A2UI is disabled for every context.
	ProcessorProvider ProcessorProvider

	// Disabled turns the A2UI prompt off for every context.
	Disabled bool
	// EnabledProvider decides per context whether A2UI is enabled (for example,
	// ProcessorStore.IsEnabled). When nil, A2UI is enabled unless Disabled is set.
	EnabledProvider EnabledProvider
}

// InstructionProvider returns an ADK instruction provider that resolves the agent's base
// instruction and appends the RequestProcessor's prompt snippet. Because ADK does not
// apply its {var} template substitution to provider output, A2UI data-binding expressions
// such as ${expression} in the snippet reach the model unchanged.
func InstructionProvider(cfg InstructionConfig) InstructionFunc {
	return func(ctx adkagent.ReadonlyContext) (string, error) {
		on, err := enabled(cfg.Disabled, cfg.EnabledProvider, ctx)
		if err != nil {
			return "", err
		}
		if !on {
			switch {
			case cfg.FallbackProvider != nil:
				return cfg.FallbackProvider(ctx)
			case cfg.FallbackInstruction != "":
				return resolveTemplateInstruction(ctx, cfg.FallbackInstruction)
			case cfg.BaseProvider != nil:
				return cfg.BaseProvider(ctx)
			default:
				return resolveTemplateInstruction(ctx, cfg.Instruction)
			}
		}

		var base string
		if cfg.BaseProvider != nil {
			base, err = cfg.BaseProvider(ctx)
		} else {
			base, err = resolveTemplateInstruction(ctx, cfg.Instruction)
		}
		if err != nil {
			return "", err
		}

		proc, err := resolveProcessor(cfg.ProcessorProvider, ctx, "InstructionProvider")
		if err != nil {
			return "", err
		}

		snippet, err := proc.PromptSnippet()
		if err != nil {
			return "", err
		}
		var parts []string
		if base != "" {
			parts = append(parts, base)
		}
		if snippet != "" {
			parts = append(parts, snippet)
		}
		return strings.Join(parts, "\n\n"), nil
	}
}

func resolveTemplateInstruction(ctx adkagent.ReadonlyContext, template string) (string, error) {
	if template == "" || ctx == nil {
		return template, nil
	}
	matches := statePlaceholderRe.FindAllStringIndex(template, -1)
	if len(matches) == 0 {
		return template, nil
	}

	var b strings.Builder
	last := 0
	for _, idx := range matches {
		if idx[0] > 0 && (template[idx[0]-1] == '$' || template[idx[0]-1] == '\\') {
			continue
		}
		b.WriteString(template[last:idx[0]])
		rawMatch := template[idx[0]:idx[1]]
		replaced, err := replaceTemplateMatch(ctx, rawMatch)
		if err != nil {
			return "", err
		}
		b.WriteString(replaced)
		last = idx[1]
	}
	b.WriteString(template[last:])
	return b.String(), nil
}

func replaceTemplateMatch(ctx adkagent.ReadonlyContext, match string) (string, error) {
	varName := strings.TrimSpace(strings.Trim(match, "{}"))
	optional := false
	if strings.HasSuffix(varName, "?") {
		optional = true
		varName = strings.TrimSuffix(varName, "?")
	}

	if after, ok := strings.CutPrefix(varName, "artifact."); ok {
		artifactsCtx, hasArtifacts := ctx.(interface{ Artifacts() adkagent.Artifacts })
		if !hasArtifacts || artifactsCtx.Artifacts() == nil {
			if optional {
				return "", nil
			}
			return "", fmt.Errorf("artifact service is not initialized")
		}
		resp, err := artifactsCtx.Artifacts().Load(ctx, after)
		if err != nil {
			if optional && errors.Is(err, fs.ErrNotExist) {
				return "", nil
			}
			return "", fmt.Errorf("failed to load artifact %s: %w", after, err)
		}
		if resp == nil || resp.Part == nil {
			return "", nil
		}
		return resp.Part.Text, nil
	}

	if !isValidADKStateKey(varName) {
		return match, nil
	}
	st := ctx.ReadonlyState()
	if st == nil {
		if optional {
			return "", nil
		}
		return "", fmt.Errorf("context variable %q not found", varName)
	}
	val, err := st.Get(varName)
	if err != nil {
		if optional && errors.Is(err, session.ErrStateKeyNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("context variable %q not found: %w", varName, err)
	}
	if val == nil {
		return "", nil
	}
	return fmt.Sprintf("%v", val), nil
}

func isValidADKStateKey(varName string) bool {
	parts := strings.Split(varName, ":")
	if len(parts) == 1 {
		return isASCIIIdentifier(varName)
	}
	if len(parts) == 2 {
		prefix := parts[0] + ":"
		if slices.Contains([]string{"app:", "user:", "temp:"}, prefix) {
			return isASCIIIdentifier(parts[1])
		}
	}
	return false
}

func isASCIIIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if i == 0 {
			if !unicode.IsLetter(r) && r != '_' {
				return false
			}
		} else if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
			return false
		}
	}
	return true
}
