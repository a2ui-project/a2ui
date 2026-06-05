package v09

import (
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
	switch countSet(m.CreateSurface != nil, m.UpdateComponents != nil, m.UpdateDataModel != nil, m.DeleteSurface != nil) {
	case 1:
		return nil
	case 0:
		return fmt.Errorf("a2ui: server message has no payload set")
	default:
		return fmt.Errorf("a2ui: server message has multiple payloads set")
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
	switch countSet(m.Action != nil, m.Error != nil) {
	case 1:
		return nil
	case 0:
		return fmt.Errorf("a2ui: client message has no payload set")
	default:
		return fmt.Errorf("a2ui: client message has multiple payloads set")
	}
}
