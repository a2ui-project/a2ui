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

import "github.com/a2ui-project/a2ui/go/core"

// ErrStreamClosed is returned when Feed or Close is called on a closed ResponseStream.
var ErrStreamClosed = core.NewStateError("the response stream is closed")

// PartialResultsCarrier is implemented by errors raised during streaming after
// earlier parts in the same call have already been validated and emitted.
type PartialResultsCarrier interface {
	PartialResults() []ResponsePart
}

// CompilationError reports a failure while compiling an inference format block into A2UI messages.
type CompilationError struct {
	*core.A2UIError
	RawContent  string
	Line        int
	Column      int
	HelpMessage string
	Partials    []ResponsePart
}

func (e *CompilationError) ErrorCategory() core.ErrorCategory { return core.CategoryCompilation }
func (e *CompilationError) Unwrap() error                     { return e.A2UIError }
func (e *CompilationError) PartialResults() []ResponsePart    { return e.Partials }

// NewCompilationError constructs a CompilationError.
func NewCompilationError(msg, rawContent string) *CompilationError {
	return &CompilationError{
		A2UIError:  &core.A2UIError{Message: msg},
		RawContent: rawContent,
	}
}

// CompilationParseError reports invalid inference format syntax (malformed DSL or JSON).
// It unwraps to both *CompilationError and *core.ParseError via Go multi-error Unwrap.
type CompilationParseError struct {
	*CompilationError
	ParseErr *core.ParseError
}

func (e *CompilationParseError) ErrorCategory() core.ErrorCategory { return core.CategoryParse }

func (e *CompilationParseError) Unwrap() []error {
	if e.ParseErr != nil {
		return []error{e.CompilationError, e.ParseErr}
	}
	return []error{e.CompilationError, core.NewParseError(e.Message)}
}

// NewCompilationParseError constructs a CompilationParseError with optional source location and hint.
func NewCompilationParseError(msg, rawContent string, line, column int, helpMsg string) *CompilationParseError {
	base := &core.A2UIError{Message: msg}
	return &CompilationParseError{
		CompilationError: &CompilationError{
			A2UIError:   base,
			RawContent:  rawContent,
			Line:        line,
			Column:      column,
			HelpMessage: helpMsg,
		},
		ParseErr: &core.ParseError{A2UIError: base},
	}
}

// CompilationValidationError reports semantic or catalog schema violations during format compilation.
// It unwraps to both *CompilationError and *core.ValidationError via Go multi-error Unwrap.
type CompilationValidationError struct {
	*CompilationError
	ValidationErr *core.ValidationError
}

func (e *CompilationValidationError) ErrorCategory() core.ErrorCategory {
	return core.CategoryValidation
}

func (e *CompilationValidationError) Unwrap() []error {
	if e.ValidationErr != nil {
		return []error{e.CompilationError, e.ValidationErr}
	}
	return []error{e.CompilationError, core.NewValidationError(e.Message, e.Details...)}
}

// NewCompilationValidationError constructs a CompilationValidationError.
func NewCompilationValidationError(msg, rawContent, helpMsg string, details ...core.ErrorDetail) *CompilationValidationError {
	base := &core.A2UIError{Message: msg, Details: details}
	return &CompilationValidationError{
		CompilationError: &CompilationError{
			A2UIError:   base,
			RawContent:  rawContent,
			HelpMessage: helpMsg,
		},
		ValidationErr: &core.ValidationError{A2UIError: base},
	}
}
