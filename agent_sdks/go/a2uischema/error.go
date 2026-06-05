package a2uischema

// ValidationCode identifies a class of validation failure.
type ValidationCode string

const (
	ValidationDuplicateComponent   ValidationCode = "duplicate_component"
	ValidationUnknownComponentRef  ValidationCode = "unknown_component_ref"
	ValidationMissingRootComponent ValidationCode = "missing_root_component"
	ValidationCycle                ValidationCode = "cycle"
	ValidationOrphanedComponent    ValidationCode = "orphaned_component"
	ValidationUnknownComponentType ValidationCode = "unknown_component_type"
	ValidationUnknownFunction      ValidationCode = "unknown_function"
	ValidationInvalidPath          ValidationCode = "invalid_path"
)

// ValidationError describes a validation failure in a form callers can inspect.
type ValidationError struct {
	Code      ValidationCode
	Path      string
	Component string
	Ref       string
	Function  string
	Message   string
}

// Error returns the human-readable validation message.
func (e *ValidationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func validationError(code ValidationCode, path, component, ref, function, message string) error {
	return &ValidationError{
		Code:      code,
		Path:      path,
		Component: component,
		Ref:       ref,
		Function:  function,
		Message:   message,
	}
}
