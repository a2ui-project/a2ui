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
	"fmt"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

// ParseError indicates invalid Express DSL syntax or malformed literals.
type ParseError struct {
	Message     string
	Line        int
	Column      int
	HelpMessage string
}

func (e *ParseError) Error() string { return e.Message }

// NewParseError creates a ParseError with optional line, column, and help hint.
func NewParseError(msg string, line, col int, helpMsg string) *ParseError {
	return &ParseError{
		Message:     msg,
		Line:        line,
		Column:      col,
		HelpMessage: helpMsg,
	}
}

// NewUndefinedRootError creates a ParseError for a missing root component variable.
func NewUndefinedRootError(rootTarget string) *ParseError {
	return &ParseError{
		Message:     fmt.Sprintf("Root target '%s' is not defined.", rootTarget),
		HelpMessage: fmt.Sprintf("Ensure root component '%s' is assigned in your Express DSL.", rootTarget),
	}
}

// ValidationError indicates a semantically invalid Express construct against the active catalogs.
type ValidationError struct {
	Message     string
	HelpMessage string
	Details     []core.ErrorDetail
}

func (e *ValidationError) Error() string { return e.Message }

// NewValidationError creates a ValidationError with message and optional help hint.
func NewValidationError(msg, helpMsg string, details ...core.ErrorDetail) *ValidationError {
	return &ValidationError{
		Message:     msg,
		HelpMessage: helpMsg,
		Details:     details,
	}
}

// NewUnknownPropertyError creates a ValidationError for an undeclared component property.
func NewUnknownPropertyError(compName, propName string, validProps []string) *ValidationError {
	msg := fmt.Sprintf("Property '%s' is not a valid property of component '%s'.", propName, compName)
	var helpMsg string
	if len(validProps) > 0 {
		sorted := slices.Clone(validProps)
		slices.Sort(sorted)
		helpMsg = fmt.Sprintf("Component '%s' accepts properties: %s.", compName, strings.Join(sorted, ", "))
	} else {
		helpMsg = fmt.Sprintf("Component '%s' has no configurable properties.", compName)
	}
	return NewValidationError(msg, helpMsg)
}

// NewDuplicatePropertyError creates a ValidationError for a component property specified more than once.
func NewDuplicatePropertyError(compName, propName string) *ValidationError {
	return NewValidationError(
		fmt.Sprintf("Property '%s' of component '%s' was provided multiple times.", propName, compName),
		fmt.Sprintf("Remove duplicate specification of property '%s' for component '%s'.", propName, compName),
	)
}

// NewInvalidParamError creates a ValidationError for an undeclared function argument name.
func NewInvalidParamError(fnName, paramName string, validParams []string) *ValidationError {
	msg := fmt.Sprintf("Argument '%s' is not a valid parameter of function '%s'.", paramName, fnName)
	var helpMsg string
	if len(validParams) > 0 {
		sorted := slices.Clone(validParams)
		slices.Sort(sorted)
		helpMsg = fmt.Sprintf("Function '%s' accepts parameters: %s.", fnName, strings.Join(sorted, ", "))
	} else {
		helpMsg = fmt.Sprintf("Function '%s' accepts no parameters.", fnName)
	}
	return NewValidationError(msg, helpMsg)
}

// NewDuplicateParamError creates a ValidationError for a function parameter specified more than once.
func NewDuplicateParamError(fnName, paramName string) *ValidationError {
	return NewValidationError(
		fmt.Sprintf("Argument '%s' of function '%s' was provided multiple times.", paramName, fnName),
		fmt.Sprintf("Remove duplicate specification of parameter '%s' for function '%s'.", paramName, fnName),
	)
}

// NewForbiddenDatabindingError creates a ValidationError when $path is passed to a static property.
func NewForbiddenDatabindingError(compName, propName string) *ValidationError {
	return NewValidationError(
		fmt.Sprintf("Property '%s' of component '%s' does not support dynamic data bindings (paths).", propName, compName),
		fmt.Sprintf("Property '%s' on '%s' must be a static literal value, not a dynamic databinding ($path).", propName, compName),
	)
}

type pendingVariableError struct {
	name string
}

func (e *pendingVariableError) Error() string {
	return fmt.Sprintf("pending variable %q", e.name)
}
