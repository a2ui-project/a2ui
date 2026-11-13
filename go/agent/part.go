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

// PartKind identifies the variant held by a ResponsePart, StreamPart, RawResponsePart, or AnswerPart.
type PartKind int

const (
	// PartKindUnset is the zero value before a part's Kind is set.
	PartKindUnset PartKind = iota
	// PartText indicates a conversational text part.
	PartText
	// PartA2UI indicates a compiled or raw A2UI part (or a live surface on AnswerPart).
	PartA2UI
	// PartError indicates a rejected-block error part.
	PartError
)

// ResponsePart represents a validated part of an LLM response: either conversational
// text (IsText) or a list of compiled A2UI wire messages (IsA2UI).
type ResponsePart struct {
	Kind PartKind
	Text string
	A2UI []core.AgentToRendererMessage
}

// NewTextPart creates a conversational text ResponsePart.
func NewTextPart(text string) ResponsePart {
	return ResponsePart{Kind: PartText, Text: text}
}

// NewA2UIPart creates an A2UI message ResponsePart.
func NewA2UIPart(messages []core.AgentToRendererMessage) ResponsePart {
	return ResponsePart{Kind: PartA2UI, A2UI: messages}
}

// IsText reports whether this part holds conversational text.
func (p ResponsePart) IsText() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartText
	}
	return p.A2UI == nil
}

// IsA2UI reports whether this part holds compiled A2UI messages.
func (p ResponsePart) IsA2UI() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartA2UI
	}
	return p.A2UI != nil
}

// StreamPart represents an item emitted incrementally from a ResponseStream:
// conversational text, compiled A2UI messages, or a rejected-block Error (when
// AfterRejectedBlock is AfterRejectedContinue).
type StreamPart struct {
	Kind  PartKind
	Text  string
	A2UI  []core.AgentToRendererMessage
	Error error
}

// NewStreamTextPart creates a streaming text part.
func NewStreamTextPart(text string) StreamPart {
	return StreamPart{Kind: PartText, Text: text}
}

// NewStreamA2UIPart creates a streaming A2UI messages part.
func NewStreamA2UIPart(messages []core.AgentToRendererMessage) StreamPart {
	return StreamPart{Kind: PartA2UI, A2UI: messages}
}

// NewStreamErrorPart creates a streaming error part for a rejected block.
func NewStreamErrorPart(err error) StreamPart {
	return StreamPart{Kind: PartError, Error: err}
}

// IsText reports whether this stream part holds text.
func (p StreamPart) IsText() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartText
	}
	return p.Error == nil && p.A2UI == nil
}

// IsA2UI reports whether this stream part holds compiled A2UI messages.
func (p StreamPart) IsA2UI() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartA2UI
	}
	return p.A2UI != nil
}

// IsError reports whether this stream part holds a rejected-block error.
func (p StreamPart) IsError() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartError
	}
	return p.Error != nil
}

// ToResponsePart converts a non-error StreamPart into a ResponsePart.
func (p StreamPart) ToResponsePart() (ResponsePart, bool) {
	if p.IsError() {
		return ResponsePart{}, false
	}
	if p.IsText() {
		return NewTextPart(p.Text), true
	}
	return NewA2UIPart(p.A2UI), true
}

// RawResponsePart represents a tokenized text or uncompiled A2UI block returned by Parser.Unwrap.
type RawResponsePart struct {
	Kind    PartKind
	Text    string
	A2UIRaw string
	IsFinal bool
}

// NewRawTextPart creates an unwrapped text part.
func NewRawTextPart(text string) RawResponsePart {
	return RawResponsePart{Kind: PartText, Text: text, IsFinal: true}
}

// NewRawA2UIPart creates an unwrapped raw A2UI block part.
func NewRawA2UIPart(raw string, isFinal bool) RawResponsePart {
	return RawResponsePart{Kind: PartA2UI, A2UIRaw: raw, IsFinal: isFinal}
}

// IsText reports whether this raw part holds text outside sentinel tags.
func (p RawResponsePart) IsText() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartText
	}
	return p.A2UIRaw == ""
}

// IsA2UI reports whether this raw part holds raw A2UI block content.
func (p RawResponsePart) IsA2UI() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartA2UI
	}
	return p.A2UIRaw != ""
}

// AnswerPart represents an accumulated item in a StreamedAnswer: text, a live
// SurfaceModel reference, or a rejected-block error.
type AnswerPart struct {
	Kind    PartKind
	Text    string
	Surface *core.SurfaceModel
	Error   error
}

// NewAnswerTextPart creates a text AnswerPart.
func NewAnswerTextPart(text string) AnswerPart {
	return AnswerPart{Kind: PartText, Text: text}
}

// NewAnswerSurfacePart creates a surface AnswerPart referencing surf.
func NewAnswerSurfacePart(surf *core.SurfaceModel) AnswerPart {
	return AnswerPart{Kind: PartA2UI, Surface: surf}
}

// NewAnswerErrorPart creates an error AnswerPart.
func NewAnswerErrorPart(err error) AnswerPart {
	return AnswerPart{Kind: PartError, Error: err}
}

// IsText reports whether this answer part holds text.
func (p AnswerPart) IsText() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartText
	}
	return p.Surface == nil && p.Error == nil
}

// IsSurface reports whether this AnswerPart holds a live SurfaceModel reference.
func (p AnswerPart) IsSurface() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartA2UI
	}
	return p.Surface != nil
}

// IsError reports whether this AnswerPart holds a rejected-block error.
func (p AnswerPart) IsError() bool {
	if p.Kind != PartKindUnset {
		return p.Kind == PartError
	}
	return p.Error != nil
}
