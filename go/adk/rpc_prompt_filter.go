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
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/genai"
)

// StripA2UIRPCParts removes callAgentFunction and agentFunctionResponse parts from req.Contents
// in place, dropping any genai.Content left with zero parts. Other A2UI messages (such as action,
// error, rendererFunctionResponse, or createSurface) are preserved.
func StripA2UIRPCParts(req *model.LLMRequest) {
	if req == nil || len(req.Contents) == 0 {
		return
	}
	keptContents := make([]*genai.Content, 0, len(req.Contents))
	for _, content := range req.Contents {
		if content == nil {
			continue
		}
		keptParts := make([]*genai.Part, 0, len(content.Parts))
		for _, part := range content.Parts {
			if !isAgentFunctionRPCPart(part) {
				keptParts = append(keptParts, part)
			}
		}
		if len(keptParts) == len(content.Parts) {
			keptContents = append(keptContents, content)
		} else if len(keptParts) > 0 {
			copied := *content
			copied.Parts = keptParts
			keptContents = append(keptContents, &copied)
		}
	}
	req.Contents = keptContents
}

// ExcludeRPCFromPrompt is an ADK BeforeModelCallback (compatible with llmagent.BeforeModelCallback)
// that strips callAgentFunction and agentFunctionResponse parts from the model prompt while
// leaving session history untouched. SendA2UIToClientToolset already runs this automatically.
func ExcludeRPCFromPrompt(_ adkagent.Context, llmRequest *model.LLMRequest) (*model.LLMResponse, error) {
	StripA2UIRPCParts(llmRequest)
	return nil, nil
}

func isAgentFunctionRPCPart(part *genai.Part) bool {
	msgs := DecodeGenAIPartA2UIMessages(part)
	if len(msgs) == 0 {
		return false
	}
	for _, m := range msgs {
		kind := rpcMessageKind(m)
		if kind != kindCallAgentFunction && kind != kindAgentFunctionResponse {
			return false
		}
	}
	return true
}
