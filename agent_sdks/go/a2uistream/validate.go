package a2uistream

import "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"

// MessageValidator validates a batch of parsed A2UI messages.
type MessageValidator interface {
	ValidateMessages([]a2ui.ServerMessage) error
}

// ParseAndValidate parses a complete response and validates each discovered message batch.
func ParseAndValidate(content string, validator MessageValidator) ([]ResponsePart, error) {
	parser := NewParser()
	parts, err := parser.ProcessChunk(content)
	if err != nil {
		return nil, err
	}
	flush, err := parser.Flush()
	if err != nil {
		return nil, err
	}
	parts = append(parts, flush...)
	if validator != nil {
		for _, part := range parts {
			if len(part.Messages) == 0 {
				continue
			}
			if err := validator.ValidateMessages(part.Messages); err != nil {
				return nil, err
			}
		}
	}
	return parts, nil
}
