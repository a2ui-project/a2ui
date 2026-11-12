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

package core

import "fmt"

// ErrorCategory names the cross-language A2UI conformance error classification.
type ErrorCategory string

const (
	// CategoryParse indicates malformed JSON, invalid DSL syntax, or unclosed blocks.
	CategoryParse ErrorCategory = "ParseError"
	// CategoryValidation indicates schema or semantic validation failure.
	CategoryValidation ErrorCategory = "ValidationError"
	// CategoryIntegrity indicates surface lifecycle or component graph integrity failure.
	CategoryIntegrity ErrorCategory = "IntegrityError"
	// CategoryRecursion indicates cyclic references or exceeding graph/call depth bounds.
	CategoryRecursion ErrorCategory = "RecursionError"
	// CategoryCatalog indicates invalid catalog definitions or failed capability negotiation.
	CategoryCatalog ErrorCategory = "CatalogError"
	// CategoryData indicates invalid JSON Pointers or forbidden data model mutations.
	CategoryData ErrorCategory = "DataError"
	// CategoryExpression indicates invalid expression template or regex syntax/evaluation.
	CategoryExpression ErrorCategory = "ExpressionError"
	// CategoryState indicates operations on a disposed or invalid state container.
	CategoryState ErrorCategory = "StateError"
	// CategoryRPC indicates function invocation or correlation failures.
	CategoryRPC ErrorCategory = "RpcError"
	// CategoryCompilation indicates inference format compilation failure.
	CategoryCompilation ErrorCategory = "CompilationError"
)

// RPCErrorCode identifies protocol-level function call error codes.
type RPCErrorCode string

const (
	RPCCodeInvalidFunctionCall RPCErrorCode = "INVALID_FUNCTION_CALL"
	RPCCodeUnknownFunction     RPCErrorCode = "UNKNOWN_FUNCTION"
	RPCCodeExecutionError      RPCErrorCode = "EXECUTION_ERROR"
	RPCCodeTimeout             RPCErrorCode = "TIMEOUT"
	RPCCodeCancelled           RPCErrorCode = "CANCELLED"
	RPCCodeDisposed            RPCErrorCode = "DISPOSED"
	RPCCodeDuplicate           RPCErrorCode = "DUPLICATE"
	RPCCodeTooManyPending      RPCErrorCode = "TOO_MANY_PENDING"
	RPCCodeNoListener          RPCErrorCode = "NO_LISTENER"
	RPCCodeUnknownError        RPCErrorCode = "UNKNOWN_ERROR"
)

// ErrorDetail describes a single path-scoped validation diagnostic.
type ErrorDetail struct {
	Path      string `json:"path,omitempty"`
	Code      string `json:"code,omitempty"`
	Message   string `json:"message"`
	SurfaceID string `json:"surfaceId,omitempty"`
}

// CategorizedError is implemented by all typed A2UI errors.
type CategorizedError interface {
	error
	ErrorCategory() ErrorCategory
}

// A2UIError is the base A2UI error payload embedded by all domain error types.
type A2UIError struct {
	Message        string
	Code           string
	Path           string
	SurfaceID      string
	FunctionCallID string
	Details        []ErrorDetail
	Cause          error
}

// Error returns the diagnostic message for e.
func (e *A2UIError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// Unwrap returns the underlying cause wrapped by e, if any.
func (e *A2UIError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// ParseError reports malformed JSON, invalid syntax, or unclosed sentinel blocks.
type ParseError struct{ *A2UIError }

// ErrorCategory returns CategoryParse.
func (e *ParseError) ErrorCategory() ErrorCategory { return CategoryParse }

// Unwrap returns the embedded *A2UIError.
func (e *ParseError) Unwrap() error { return e.A2UIError }

// NewParseError creates a ParseError with the given message.
func NewParseError(msg string) *ParseError {
	return &ParseError{A2UIError: &A2UIError{Message: msg}}
}

// NewParseErrorf creates a formatted ParseError.
func NewParseErrorf(format string, args ...any) *ParseError {
	return NewParseError(fmt.Sprintf(format, args...))
}

// ValidationError reports schema, property, or structural validation failures.
type ValidationError struct{ *A2UIError }

// ErrorCategory returns CategoryValidation.
func (e *ValidationError) ErrorCategory() ErrorCategory { return CategoryValidation }

// Unwrap returns the embedded *A2UIError.
func (e *ValidationError) Unwrap() error { return e.A2UIError }

// NewValidationError creates a ValidationError with the given message and optional details.
func NewValidationError(msg string, details ...ErrorDetail) *ValidationError {
	return &ValidationError{A2UIError: &A2UIError{Message: msg, Details: details}}
}

// NewValidationErrorf creates a formatted ValidationError.
func NewValidationErrorf(format string, args ...any) *ValidationError {
	return NewValidationError(fmt.Sprintf(format, args...))
}

// IntegrityError reports surface lifecycle or component topology violations.
// It unwraps to *ValidationError so errors.As matches both IntegrityError and ValidationError.
type IntegrityError struct {
	*ValidationError
}

// ErrorCategory returns CategoryIntegrity.
func (e *IntegrityError) ErrorCategory() ErrorCategory { return CategoryIntegrity }

// Unwrap returns the embedded *ValidationError.
func (e *IntegrityError) Unwrap() error { return e.ValidationError }

// NewIntegrityError creates an IntegrityError with the given message.
func NewIntegrityError(msg string) *IntegrityError {
	return &IntegrityError{
		ValidationError: &ValidationError{
			A2UIError: &A2UIError{Message: msg, Code: "INTEGRITY_ERROR"},
		},
	}
}

// NewIntegrityErrorf creates a formatted IntegrityError.
func NewIntegrityErrorf(format string, args ...any) *IntegrityError {
	return NewIntegrityError(fmt.Sprintf(format, args...))
}

// RecursionError reports cyclic component references or exceeded nesting depth.
// It unwraps to *ValidationError so errors.As matches both RecursionError and ValidationError.
type RecursionError struct {
	*ValidationError
}

// ErrorCategory returns CategoryRecursion.
func (e *RecursionError) ErrorCategory() ErrorCategory { return CategoryRecursion }

// Unwrap returns the embedded *ValidationError.
func (e *RecursionError) Unwrap() error { return e.ValidationError }

// NewRecursionError creates a RecursionError with the given message and the RECURSION_LIMIT_EXCEEDED wire code.
func NewRecursionError(msg string) *RecursionError {
	return &RecursionError{
		ValidationError: &ValidationError{
			A2UIError: &A2UIError{Message: msg, Code: "RECURSION_LIMIT_EXCEEDED"},
		},
	}
}

// CatalogError reports catalog loading, schema, or capability negotiation failures.
type CatalogError struct{ *A2UIError }

// ErrorCategory returns CategoryCatalog.
func (e *CatalogError) ErrorCategory() ErrorCategory { return CategoryCatalog }

// Unwrap returns the embedded *A2UIError.
func (e *CatalogError) Unwrap() error { return e.A2UIError }

// NewCatalogError creates a CatalogError with the given message.
func NewCatalogError(msg string) *CatalogError {
	return &CatalogError{A2UIError: &A2UIError{Message: msg}}
}

// NewCatalogErrorf creates a formatted CatalogError.
func NewCatalogErrorf(format string, args ...any) *CatalogError {
	return NewCatalogError(fmt.Sprintf(format, args...))
}

// DataError reports invalid JSON Pointers or forbidden data model writes.
type DataError struct{ *A2UIError }

// ErrorCategory returns CategoryData.
func (e *DataError) ErrorCategory() ErrorCategory { return CategoryData }

// Unwrap returns the embedded *A2UIError.
func (e *DataError) Unwrap() error { return e.A2UIError }

// NewDataError creates a DataError with the given message.
func NewDataError(msg string) *DataError {
	return &DataError{A2UIError: &A2UIError{Message: msg}}
}

// NewDataErrorf creates a formatted DataError.
func NewDataErrorf(format string, args ...any) *DataError {
	return NewDataError(fmt.Sprintf(format, args...))
}

// ExpressionError reports invalid expression templates or forbidden/unsafe regex patterns.
type ExpressionError struct{ *A2UIError }

// ErrorCategory returns CategoryExpression.
func (e *ExpressionError) ErrorCategory() ErrorCategory { return CategoryExpression }

// Unwrap returns the embedded *A2UIError.
func (e *ExpressionError) Unwrap() error { return e.A2UIError }

// NewExpressionError creates an ExpressionError with the given message.
func NewExpressionError(msg string) *ExpressionError {
	return &ExpressionError{A2UIError: &A2UIError{Message: msg, Code: "EXPRESSION_ERROR"}}
}

// NewExpressionErrorf creates a formatted ExpressionError.
func NewExpressionErrorf(format string, args ...any) *ExpressionError {
	return NewExpressionError(fmt.Sprintf(format, args...))
}

// StateError reports operations against disposed or invalid state objects.
type StateError struct{ *A2UIError }

// ErrorCategory returns CategoryState.
func (e *StateError) ErrorCategory() ErrorCategory { return CategoryState }

// Unwrap returns the embedded *A2UIError.
func (e *StateError) Unwrap() error { return e.A2UIError }

// NewStateError creates a StateError with the given message.
func NewStateError(msg string) *StateError {
	return &StateError{A2UIError: &A2UIError{Message: msg}}
}

// RPCError reports function invocation, boundary, timeout, or cancellation failures.
type RPCError struct {
	*A2UIError
	RPCCode RPCErrorCode
}

// ErrorCategory returns CategoryRPC.
func (e *RPCError) ErrorCategory() ErrorCategory { return CategoryRPC }

// Unwrap returns the embedded *A2UIError.
func (e *RPCError) Unwrap() error { return e.A2UIError }

// NewRPCError creates an RPCError with the given RPCErrorCode and message.
func NewRPCError(code RPCErrorCode, msg string) *RPCError {
	return &RPCError{
		A2UIError: &A2UIError{Message: msg, Code: string(code)},
		RPCCode:   code,
	}
}
