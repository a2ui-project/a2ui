package v010

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// MarshalJSON implements json.Marshaler for ServerMessage.
func (m ServerMessage) MarshalJSON() ([]byte, error) {
	if err := m.validate(); err != nil {
		return nil, err
	}
	type alias ServerMessage
	return json.Marshal(alias(m))
}

// UnmarshalJSON implements json.Unmarshaler for ServerMessage.
func (m *ServerMessage) UnmarshalJSON(data []byte) error {
	type alias ServerMessage
	var am alias
	if err := json.Unmarshal(data, &am); err != nil {
		return fmt.Errorf("a2ui: unmarshal server message: %w", err)
	}
	msg := ServerMessage(am)
	if err := msg.validate(); err != nil {
		return err
	}
	*m = msg
	return nil
}

func (m ServerMessage) validate() error {
	switch countSet(m.CreateSurface != nil, m.UpdateComponents != nil, m.UpdateDataModel != nil, m.DeleteSurface != nil, m.CallFunction != nil, m.ActionResponse != nil) {
	case 1:
	case 0:
		return fmt.Errorf("a2ui: server message has no payload set")
	default:
		return fmt.Errorf("a2ui: server message has multiple payloads set")
	}
	if m.CallFunction != nil {
		if m.FunctionCallID == "" {
			return fmt.Errorf("a2ui: call function message functionCallId is required")
		}
		if m.CallFunction.Call == "" {
			return fmt.Errorf("a2ui: call function call is required")
		}
		if m.CallFunction.ReturnType == "" {
			return fmt.Errorf("a2ui: call function returnType is required")
		}
	}
	if m.ActionResponse != nil && m.ActionID == "" {
		return fmt.Errorf("a2ui: action response message actionId is required")
	}
	return nil
}

// MarshalJSON implements json.Marshaler for ActionResponse.
func (r ActionResponse) MarshalJSON() ([]byte, error) {
	hasValue := r.HasValue || r.Value != nil
	hasError := r.Error != nil
	switch {
	case hasValue && hasError:
		return nil, fmt.Errorf("a2ui: action response has both value and error set")
	case hasValue:
		return json.Marshal(struct {
			Value any `json:"value"`
		}{Value: r.Value})
	case hasError:
		return json.Marshal(struct {
			Error *ActionResponseError `json:"error"`
		}{Error: r.Error})
	default:
		return nil, fmt.Errorf("a2ui: action response has no value or error set")
	}
}

// UnmarshalJSON implements json.Unmarshaler for ActionResponse.
func (r *ActionResponse) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("a2ui: unmarshal action response: %w", err)
	}
	valueData, hasValue := fields["value"]
	errorData, hasError := fields["error"]
	switch {
	case hasValue && hasError:
		return fmt.Errorf("a2ui: action response must not have both value and error")
	case hasValue:
		var value any
		if string(bytes.TrimSpace(valueData)) != "null" {
			if err := json.Unmarshal(valueData, &value); err != nil {
				return fmt.Errorf("a2ui: unmarshal action response value: %w", err)
			}
		}
		*r = ActionResponse{Value: value, HasValue: true}
		return nil
	case hasError:
		var responseError ActionResponseError
		if err := json.Unmarshal(errorData, &responseError); err != nil {
			return fmt.Errorf("a2ui: unmarshal action response error: %w", err)
		}
		*r = ActionResponse{Error: &responseError}
		return nil
	default:
		return fmt.Errorf("a2ui: action response must have value or error")
	}
}

// MarshalJSON implements json.Marshaler for ClientMessage.
func (m ClientMessage) MarshalJSON() ([]byte, error) {
	if err := m.validate(); err != nil {
		return nil, err
	}
	type alias ClientMessage
	return json.Marshal(alias(m))
}

// UnmarshalJSON implements json.Unmarshaler for ClientMessage.
func (m *ClientMessage) UnmarshalJSON(data []byte) error {
	type alias ClientMessage
	var am alias
	if err := json.Unmarshal(data, &am); err != nil {
		return fmt.Errorf("a2ui: unmarshal client message: %w", err)
	}
	msg := ClientMessage(am)
	if err := msg.validate(); err != nil {
		return err
	}
	*m = msg
	return nil
}

func (m ClientMessage) validate() error {
	switch countSet(m.Action != nil, m.FunctionResponse != nil, m.Error != nil) {
	case 1:
	case 0:
		return fmt.Errorf("a2ui: client message has no payload set")
	default:
		return fmt.Errorf("a2ui: client message has multiple payloads set")
	}
	if m.Error != nil {
		if m.Error.Code == "" {
			return fmt.Errorf("a2ui: client error code is required")
		}
		if m.Error.Message == "" {
			return fmt.Errorf("a2ui: client error message is required")
		}
		switch countSet(m.Error.SurfaceID != "", m.Error.FunctionCallID != "") {
		case 1:
		case 0:
			return fmt.Errorf("a2ui: client error must have surfaceId or functionCallId")
		default:
			return fmt.Errorf("a2ui: client error must not have both surfaceId and functionCallId")
		}
	}
	if m.FunctionResponse != nil {
		if m.FunctionResponse.FunctionCallID == "" {
			return fmt.Errorf("a2ui: function response functionCallId is required")
		}
		if m.FunctionResponse.Call == "" {
			return fmt.Errorf("a2ui: function response call is required")
		}
	}
	return nil
}
