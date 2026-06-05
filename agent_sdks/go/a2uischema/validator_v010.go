package a2uischema

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"

	a2uiv010 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v010"
)

func (v *Validator) parseMessagesV010(data []byte) ([]a2uiv010.ServerMessage, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil, fmt.Errorf("schema: empty payload")
	}
	if data[0] == '[' {
		var msgs []a2uiv010.ServerMessage
		if err := json.Unmarshal(data, &msgs); err != nil {
			return nil, fmt.Errorf("schema: parse messages: %w", err)
		}
		return msgs, nil
	}
	var msg a2uiv010.ServerMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("schema: parse message: %w", err)
	}
	return []a2uiv010.ServerMessage{msg}, nil
}

func (v *Validator) validateMessagesV010(msgs []a2uiv010.ServerMessage) error {
	if len(msgs) == 0 {
		return fmt.Errorf("schema: no messages to validate")
	}
	surfaces := make(map[string]string)
	surfaceComponents := make(map[string]map[string]bool)
	for i, msg := range msgs {
		if err := v.validateMessageV010(msg); err != nil {
			return fmt.Errorf("schema: message[%d]: %w", i, err)
		}
		switch {
		case msg.CreateSurface != nil:
			surfaces[msg.CreateSurface.SurfaceID] = msg.CreateSurface.CatalogID
			if surfaceComponents[msg.CreateSurface.SurfaceID] == nil {
				surfaceComponents[msg.CreateSurface.SurfaceID] = make(map[string]bool)
			}
		case msg.UpdateComponents != nil:
			if catalogID, ok := surfaces[msg.UpdateComponents.SurfaceID]; ok {
				_ = catalogID
			}
			known := surfaceComponents[msg.UpdateComponents.SurfaceID]
			if err := v.validateComponentsV010(msg.UpdateComponents.Components, known); err != nil {
				return fmt.Errorf("updateComponents: %w", err)
			}
			if known == nil {
				known = make(map[string]bool)
				surfaceComponents[msg.UpdateComponents.SurfaceID] = known
			}
			for _, component := range msg.UpdateComponents.Components {
				known[component.ID] = true
			}
		case msg.UpdateDataModel != nil:
			if err := validatePath(msg.UpdateDataModel.Path, true); err != nil {
				return fmt.Errorf("updateDataModel.path: %w", err)
			}
		}
	}
	return nil
}

func (v *Validator) validateMessageV010(msg a2uiv010.ServerMessage) error {
	wantVersion := Version010
	if v.catalog != nil {
		wantVersion = v.catalog.Version
	}
	if msg.Version != string(wantVersion) {
		return fmt.Errorf("version = %q, want %q", msg.Version, wantVersion)
	}
	if msg.FunctionCallID != "" && msg.CallFunction == nil {
		return fmt.Errorf("functionCallId requires callFunction")
	}
	if msg.ActionID != "" && msg.ActionResponse == nil {
		return fmt.Errorf("actionId requires actionResponse")
	}
	switch countSetV010(msg.CreateSurface != nil, msg.UpdateComponents != nil, msg.UpdateDataModel != nil, msg.DeleteSurface != nil, msg.CallFunction != nil, msg.ActionResponse != nil) {
	case 1:
	case 0:
		return fmt.Errorf("message has no payload")
	default:
		return fmt.Errorf("message has multiple payloads")
	}
	switch {
	case msg.CreateSurface != nil:
		if msg.CreateSurface.SurfaceID == "" {
			return fmt.Errorf("createSurface.surfaceId is required")
		}
		if msg.CreateSurface.CatalogID == "" {
			return fmt.Errorf("createSurface.catalogId is required")
		}
		if v.catalog != nil {
			id, err := v.catalog.ID()
			if err == nil && len(v.allowedComponents) > 0 && msg.CreateSurface.CatalogID != id {
				return fmt.Errorf("createSurface.catalogId = %q, want %q", msg.CreateSurface.CatalogID, id)
			}
		}
	case msg.UpdateComponents != nil:
		if msg.UpdateComponents.SurfaceID == "" {
			return fmt.Errorf("updateComponents.surfaceId is required")
		}
		if len(msg.UpdateComponents.Components) == 0 {
			return fmt.Errorf("updateComponents.components must not be empty")
		}
	case msg.UpdateDataModel != nil:
		if msg.UpdateDataModel.SurfaceID == "" {
			return fmt.Errorf("updateDataModel.surfaceId is required")
		}
	case msg.DeleteSurface != nil:
		if msg.DeleteSurface.SurfaceID == "" {
			return fmt.Errorf("deleteSurface.surfaceId is required")
		}
	case msg.CallFunction != nil:
		if msg.FunctionCallID == "" {
			return fmt.Errorf("functionCallId is required")
		}
		if err := v.validateFunctionCallV010(*msg.CallFunction, 0, true); err != nil {
			return fmt.Errorf("callFunction: %w", err)
		}
	case msg.ActionResponse != nil:
		if msg.ActionID == "" {
			return fmt.Errorf("actionId is required")
		}
		if err := validateActionResponseV010(*msg.ActionResponse); err != nil {
			return fmt.Errorf("actionResponse: %w", err)
		}
	}
	return nil
}

func (v *Validator) validateComponentsV010(components []a2uiv010.Component, known map[string]bool) error {
	ids := make(map[string]int, len(components))
	for i, component := range components {
		if err := v.validateComponentV010(component); err != nil {
			return fmt.Errorf("component[%d] (%s): %w", i, component.ID, err)
		}
		if _, ok := ids[component.ID]; ok {
			return validationError(ValidationDuplicateComponent, "", component.ID, "", "", fmt.Sprintf("duplicate component id %q", component.ID))
		}
		ids[component.ID] = i
	}
	graph := make(map[string][]string, len(components))
	for _, component := range components {
		refs, err := componentRefsV010(component)
		if err != nil {
			return fmt.Errorf("component %q: %w", component.ID, err)
		}
		graph[component.ID] = nil
		for _, ref := range refs {
			if _, ok := ids[ref]; ok {
				graph[component.ID] = append(graph[component.ID], ref)
				continue
			}
			if known != nil && known[ref] {
				continue
			}
			return validationError(ValidationUnknownComponentRef, "", component.ID, ref, "", fmt.Sprintf("component %q references unknown component %q", component.ID, ref))
		}
	}
	if _, ok := ids["root"]; !ok && len(known) == 0 {
		return validationError(ValidationMissingRootComponent, "", "root", "", "", fmt.Sprintf("components must include id %q", "root"))
	}
	if _, ok := ids["root"]; ok {
		if err := validateTopology(graph, "root"); err != nil {
			return err
		}
	}
	return nil
}

func (v *Validator) validateComponentV010(component a2uiv010.Component) error {
	if component.ID == "" {
		return fmt.Errorf("id is required")
	}
	componentType := component.ComponentType()
	if componentType == "" {
		return fmt.Errorf("exactly one concrete component type must be set")
	}
	if len(v.allowedComponents) > 0 {
		if _, ok := v.allowedComponents[componentType]; !ok {
			return validationError(ValidationUnknownComponentType, "", component.ID, "", "", fmt.Sprintf("component type %q is not allowed by the selected catalog", componentType))
		}
	}
	for _, check := range component.Checks {
		if check.Message == "" {
			return fmt.Errorf("check message is required")
		}
		if err := v.validateDynamicBooleanV010(check.Condition, 0); err != nil {
			return fmt.Errorf("check condition: %w", err)
		}
	}
	if component.Accessibility != nil {
		if component.Accessibility.Label != nil {
			if err := v.validateDynamicStringV010(*component.Accessibility.Label, 0); err != nil {
				return fmt.Errorf("accessibility.label: %w", err)
			}
		}
		if component.Accessibility.Description != nil {
			if err := v.validateDynamicStringV010(*component.Accessibility.Description, 0); err != nil {
				return fmt.Errorf("accessibility.description: %w", err)
			}
		}
	}
	switch {
	case component.Text != nil:
		return v.validateTextComponentV010(*component.Text)
	case component.Image != nil:
		return v.validateImageComponentV010(*component.Image)
	case component.Icon != nil:
		return v.validateIconComponentV010(*component.Icon)
	case component.Video != nil:
		return v.validateVideoComponentV010(*component.Video)
	case component.AudioPlayer != nil:
		return v.validateAudioPlayerComponentV010(*component.AudioPlayer)
	case component.Row != nil:
		return v.validateContainerChildrenV010(component.Row.Children)
	case component.Column != nil:
		return v.validateContainerChildrenV010(component.Column.Children)
	case component.List != nil:
		return v.validateContainerChildrenV010(component.List.Children)
	case component.Card != nil:
		if component.Card.Child == "" {
			return fmt.Errorf("card.child is required")
		}
	case component.Tabs != nil:
		if len(component.Tabs.Tabs) == 0 {
			return fmt.Errorf("tabs.tabs must not be empty")
		}
		for _, tab := range component.Tabs.Tabs {
			if tab.Child == "" {
				return fmt.Errorf("tabs.child is required")
			}
			if err := v.validateDynamicStringV010(tab.Title, 0); err != nil {
				return fmt.Errorf("tabs.title: %w", err)
			}
		}
	case component.Modal != nil:
		if component.Modal.Content == "" || component.Modal.Trigger == "" {
			return fmt.Errorf("modal.content and modal.trigger are required")
		}
	case component.Divider != nil:
		return nil
	case component.Button != nil:
		if component.Button.Child == "" {
			return fmt.Errorf("button.child is required")
		}
		if err := v.validateActionV010(component.Button.Action, 0); err != nil {
			return fmt.Errorf("button.action: %w", err)
		}
	case component.TextField != nil:
		if err := v.validateDynamicStringV010(component.TextField.Label, 0); err != nil {
			return fmt.Errorf("textField.label: %w", err)
		}
		if component.TextField.Value != nil {
			if err := v.validateDynamicStringV010(*component.TextField.Value, 0); err != nil {
				return fmt.Errorf("textField.value: %w", err)
			}
		}
		if component.TextField.Placeholder != nil {
			if err := v.validateDynamicStringV010(*component.TextField.Placeholder, 0); err != nil {
				return fmt.Errorf("textField.placeholder: %w", err)
			}
		}
	case component.CheckBox != nil:
		if err := v.validateDynamicStringV010(component.CheckBox.Label, 0); err != nil {
			return fmt.Errorf("checkBox.label: %w", err)
		}
		if err := v.validateDynamicBooleanV010(component.CheckBox.Value, 0); err != nil {
			return fmt.Errorf("checkBox.value: %w", err)
		}
	case component.ChoicePicker != nil:
		if len(component.ChoicePicker.Options) == 0 {
			return fmt.Errorf("choicePicker.options must not be empty")
		}
		if component.ChoicePicker.Label != nil {
			if err := v.validateDynamicStringV010(*component.ChoicePicker.Label, 0); err != nil {
				return fmt.Errorf("choicePicker.label: %w", err)
			}
		}
		for _, option := range component.ChoicePicker.Options {
			if option.Value == "" {
				return fmt.Errorf("choicePicker option value is required")
			}
			if err := v.validateDynamicStringV010(option.Label, 0); err != nil {
				return fmt.Errorf("choicePicker option label: %w", err)
			}
		}
		if err := v.validateDynamicStringListV010(component.ChoicePicker.Value, 0); err != nil {
			return fmt.Errorf("choicePicker.value: %w", err)
		}
	case component.Slider != nil:
		if err := v.validateDynamicNumberV010(component.Slider.Value, 0); err != nil {
			return fmt.Errorf("slider.value: %w", err)
		}
		if component.Slider.Label != nil {
			if err := v.validateDynamicStringV010(*component.Slider.Label, 0); err != nil {
				return fmt.Errorf("slider.label: %w", err)
			}
		}
	case component.DateTimeInput != nil:
		if err := v.validateDynamicStringV010(component.DateTimeInput.Value, 0); err != nil {
			return fmt.Errorf("dateTimeInput.value: %w", err)
		}
		for name, value := range map[string]*a2uiv010.DynamicString{
			"label": component.DateTimeInput.Label,
			"max":   component.DateTimeInput.Max,
			"min":   component.DateTimeInput.Min,
		} {
			if value != nil {
				if err := v.validateDynamicStringV010(*value, 0); err != nil {
					return fmt.Errorf("dateTimeInput.%s: %w", name, err)
				}
			}
		}
	}
	return nil
}

func (v *Validator) validateTextComponentV010(component a2uiv010.TextComponent) error {
	return v.validateDynamicStringV010(component.Text, 0)
}

func (v *Validator) validateImageComponentV010(component a2uiv010.ImageComponent) error {
	if err := v.validateDynamicStringV010(component.URL, 0); err != nil {
		return err
	}
	if component.Description != nil {
		if err := v.validateDynamicStringV010(*component.Description, 0); err != nil {
			return err
		}
	}
	return nil
}

func (v *Validator) validateIconComponentV010(component a2uiv010.IconComponent) error {
	if component.Name.Name == nil && component.Name.Path == nil {
		return fmt.Errorf("icon.name is required")
	}
	return nil
}

func (v *Validator) validateVideoComponentV010(component a2uiv010.VideoComponent) error {
	if err := v.validateDynamicStringV010(component.URL, 0); err != nil {
		return err
	}
	if component.PosterURL != nil {
		return v.validateDynamicStringV010(*component.PosterURL, 0)
	}
	return nil
}

func (v *Validator) validateAudioPlayerComponentV010(component a2uiv010.AudioPlayerComponent) error {
	if err := v.validateDynamicStringV010(component.URL, 0); err != nil {
		return err
	}
	if component.Description != nil {
		return v.validateDynamicStringV010(*component.Description, 0)
	}
	return nil
}

func (v *Validator) validateContainerChildrenV010(children a2uiv010.ChildList) error {
	if len(children.IDs) == 0 && children.Template == nil {
		return fmt.Errorf("children must not be empty")
	}
	if children.Template != nil {
		if children.Template.ComponentID == "" {
			return fmt.Errorf("children.template.componentId is required")
		}
		if err := validatePath(children.Template.Path, false); err != nil {
			return fmt.Errorf("children.template.path: %w", err)
		}
	}
	return nil
}

func (v *Validator) validateActionV010(action a2uiv010.Action, depth int) error {
	switch {
	case action.Event != nil && action.FunctionCall != nil:
		return fmt.Errorf("action must not have both event and functionCall")
	case action.Event != nil:
		if action.Event.Name == "" {
			return fmt.Errorf("event.name is required")
		}
		if action.Event.ResponsePath != "" {
			if err := validatePath(action.Event.ResponsePath, false); err != nil {
				return fmt.Errorf("event.responsePath: %w", err)
			}
		}
		for key, value := range action.Event.Context {
			if err := v.validateDynamicValueV010(value, depth+1); err != nil {
				return fmt.Errorf("event.context[%q]: %w", key, err)
			}
		}
	case action.FunctionCall != nil:
		if err := v.validateFunctionCallV010(*action.FunctionCall, depth+1, false); err != nil {
			return err
		}
	default:
		return fmt.Errorf("action must have event or functionCall")
	}
	return nil
}

func (v *Validator) validateDynamicStringV010(value a2uiv010.DynamicString, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCallV010(*value.FunctionCall, depth+1, false)
	default:
		return fmt.Errorf("dynamic string has no value")
	}
}

func (v *Validator) validateDynamicNumberV010(value a2uiv010.DynamicNumber, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCallV010(*value.FunctionCall, depth+1, false)
	default:
		return fmt.Errorf("dynamic number has no value")
	}
}

func (v *Validator) validateDynamicBooleanV010(value a2uiv010.DynamicBoolean, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCallV010(*value.FunctionCall, depth+1, false)
	default:
		return fmt.Errorf("dynamic boolean has no value")
	}
}

func (v *Validator) validateDynamicStringListV010(value a2uiv010.DynamicStringList, depth int) error {
	switch {
	case value.Literal != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCallV010(*value.FunctionCall, depth+1, false)
	default:
		return fmt.Errorf("dynamic string list has no value")
	}
}

func (v *Validator) validateDynamicValueV010(value a2uiv010.DynamicValue, depth int) error {
	switch {
	case value.String != nil, value.Number != nil, value.Bool != nil, value.Array != nil:
		return nil
	case value.Binding != nil:
		return validatePath(value.Binding.Path, false)
	case value.FunctionCall != nil:
		return v.validateFunctionCallV010(*value.FunctionCall, depth+1, false)
	default:
		return fmt.Errorf("dynamic value has no value")
	}
}

func (v *Validator) validateFunctionCallV010(call a2uiv010.FunctionCall, depth int, requireRemote bool) error {
	if depth > 32 {
		return fmt.Errorf("function call recursion depth exceeded")
	}
	if call.Call == "" {
		return fmt.Errorf("function call name is required")
	}
	if len(v.allowedFunctions) > 0 {
		if _, ok := v.allowedFunctions[call.Call]; !ok {
			return validationError(ValidationUnknownFunction, "", "", "", call.Call, fmt.Sprintf("unknown function %q", call.Call))
		}
	}
	if requireRemote {
		if call.ReturnType == "" {
			return fmt.Errorf("returnType is required")
		}
	}
	for key, arg := range call.Args {
		if err := v.validateFunctionArgV010(arg, depth+1); err != nil {
			return fmt.Errorf("function arg %q: %w", key, err)
		}
	}
	return nil
}

func (v *Validator) validateFunctionArgV010(arg any, depth int) error {
	switch value := arg.(type) {
	case nil, string, bool, float64, int:
		return nil
	case []string:
		return nil
	case []any:
		for i, item := range value {
			if err := v.validateFunctionArgV010(item, depth+1); err != nil {
				return fmt.Errorf("[%d]: %w", i, err)
			}
		}
		return nil
	case map[string]any:
		if _, ok := value["path"]; ok {
			path, _ := value["path"].(string)
			return validatePath(path, false)
		}
		if _, ok := value["call"]; ok {
			data, err := json.Marshal(value)
			if err != nil {
				return err
			}
			var call a2uiv010.FunctionCall
			if err := json.Unmarshal(data, &call); err != nil {
				return err
			}
			return v.validateFunctionCallV010(call, depth+1, false)
		}
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			if err := v.validateFunctionArgV010(value[key], depth+1); err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
		}
		return nil
	case a2uiv010.DynamicValue:
		return v.validateDynamicValueV010(value, depth+1)
	case a2uiv010.DynamicString:
		return v.validateDynamicStringV010(value, depth+1)
	case a2uiv010.DynamicNumber:
		return v.validateDynamicNumberV010(value, depth+1)
	case a2uiv010.DynamicBoolean:
		return v.validateDynamicBooleanV010(value, depth+1)
	case a2uiv010.DynamicStringList:
		return v.validateDynamicStringListV010(value, depth+1)
	default:
		return nil
	}
}

func validateActionResponseV010(response a2uiv010.ActionResponse) error {
	hasValue := response.HasValue || response.Value != nil
	hasError := response.Error != nil
	switch {
	case hasValue && hasError:
		return fmt.Errorf("must not have both value and error")
	case hasValue:
		return nil
	case hasError:
		if response.Error.Code == "" {
			return fmt.Errorf("error.code is required")
		}
		if response.Error.Message == "" {
			return fmt.Errorf("error.message is required")
		}
		return nil
	default:
		return fmt.Errorf("must have value or error")
	}
}

func componentRefsV010(component a2uiv010.Component) ([]string, error) {
	switch {
	case component.Button != nil:
		return []string{component.Button.Child}, nil
	case component.Card != nil:
		return []string{component.Card.Child}, nil
	case component.Column != nil:
		return childListRefsV010(component.Column.Children)
	case component.List != nil:
		return childListRefsV010(component.List.Children)
	case component.Row != nil:
		return childListRefsV010(component.Row.Children)
	case component.Modal != nil:
		return []string{component.Modal.Trigger, component.Modal.Content}, nil
	case component.Tabs != nil:
		refs := make([]string, 0, len(component.Tabs.Tabs))
		for _, tab := range component.Tabs.Tabs {
			refs = append(refs, tab.Child)
		}
		return refs, nil
	default:
		return nil, nil
	}
}

func childListRefsV010(children a2uiv010.ChildList) ([]string, error) {
	if children.Template != nil {
		return []string{children.Template.ComponentID}, nil
	}
	return append([]string(nil), children.IDs...), nil
}

func countSetV010(values ...bool) int {
	var count int
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}
