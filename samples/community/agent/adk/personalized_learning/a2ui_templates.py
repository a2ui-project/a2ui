# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
A2UI Templates for Learning Materials

Provides templates and examples for generating A2UI JSON payloads
for various learning material formats.
"""

SURFACE_ID = "learningContent"

# Flashcard A2UI template example
FLASHCARD_EXAMPLE = f"""
Example A2UI JSON for a set of flashcards:

[
  {{"beginRendering": {{"surfaceId": "{SURFACE_ID}", "root": "mainColumn"}}}},
  {{
    "surfaceUpdate": {{
      "surfaceId": "{SURFACE_ID}",
      "components": [
        {{
          "id": "mainColumn",
          "component": {{
            "Column": {{
              "children": {{"explicitList": ["headerText", "flashcardRow"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "headerText",
          "component": {{
            "Text": {{
              "text": {{"literalString": "Study Flashcards: ATP & Bond Energy"}},
              "usageHint": "h2"
            }}
          }}
        }},
        {{
          "id": "flashcardRow",
          "component": {{
            "Row": {{
              "children": {{"explicitList": ["card1", "card2", "card3"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "card1",
          "component": {{
            "Flashcard": {{
              "front": {{"literalString": "What happens when ATP is hydrolyzed?"}},
              "back": {{"literalString": "ATP + H2O → ADP + Pi + Energy. Energy is released because the products are MORE STABLE than ATP."}},
              "category": {{"literalString": "Biochemistry"}}
            }}
          }}
        }},
        {{
          "id": "card2",
          "component": {{
            "Flashcard": {{
              "front": {{"literalString": "Does breaking a bond release or require energy?"}},
              "back": {{"literalString": "Breaking ANY bond REQUIRES energy input. Energy is released when new, more stable bonds FORM."}},
              "category": {{"literalString": "Chemistry"}}
            }}
          }}
        }},
        {{
          "id": "card3",
          "component": {{
            "Flashcard": {{
              "front": {{"literalString": "Why is 'energy stored in bonds' misleading?"}},
              "back": {{"literalString": "Bonds don't store energy like batteries. Energy comes from the STABILITY DIFFERENCE between reactants and products."}},
              "category": {{"literalString": "MCAT Concept"}}
            }}
          }}
        }}
      ]
    }}
  }}
]
"""

# Audio/Podcast A2UI template
AUDIO_EXAMPLE = f"""
Example A2UI JSON for an audio player (podcast):

[
  {{"beginRendering": {{"surfaceId": "{SURFACE_ID}", "root": "audioCard"}}}},
  {{
    "surfaceUpdate": {{
      "surfaceId": "{SURFACE_ID}",
      "components": [
        {{
          "id": "audioCard",
          "component": {{
            "Card": {{
              "child": "audioContent"
            }}
          }}
        }},
        {{
          "id": "audioContent",
          "component": {{
            "Column": {{
              "children": {{"explicitList": ["audioHeader", "audioPlayer", "audioDescription"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "audioHeader",
          "component": {{
            "Row": {{
              "children": {{"explicitList": ["audioIcon", "audioTitle"]}},
              "distribution": "start",
              "alignment": "center"
            }}
          }}
        }},
        {{
          "id": "audioIcon",
          "component": {{
            "Icon": {{
              "name": {{"literalString": "podcasts"}}
            }}
          }}
        }},
        {{
          "id": "audioTitle",
          "component": {{
            "Text": {{
              "text": {{"literalString": "ATP & Chemical Stability Podcast"}},
              "usageHint": "h3"
            }}
          }}
        }},
        {{
          "id": "audioPlayer",
          "component": {{
            "AudioPlayer": {{
              "url": {{"literalString": "/assets/podcast.m4a"}},
              "audioTitle": {{"literalString": "Understanding ATP Energy Release"}},
              "audioDescription": {{"literalString": "A personalized podcast about ATP and chemical stability"}}
            }}
          }}
        }},
        {{
          "id": "audioDescription",
          "component": {{
            "Text": {{
              "text": {{"literalString": "This 10-minute podcast explains why 'energy stored in bonds' is a misconception and how to think about ATP correctly for the MCAT."}},
              "usageHint": "body"
            }}
          }}
        }}
      ]
    }}
  }}
]
"""

# Video A2UI template
VIDEO_EXAMPLE = f"""
Example A2UI JSON for a video player:

[
  {{"beginRendering": {{"surfaceId": "{SURFACE_ID}", "root": "videoCard"}}}},
  {{
    "surfaceUpdate": {{
      "surfaceId": "{SURFACE_ID}",
      "components": [
        {{
          "id": "videoCard",
          "component": {{
            "Card": {{
              "child": "videoContent"
            }}
          }}
        }},
        {{
          "id": "videoContent",
          "component": {{
            "Column": {{
              "children": {{"explicitList": ["videoTitle", "videoPlayer", "videoDescription"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "videoTitle",
          "component": {{
            "Text": {{
              "text": {{"literalString": "Visual Explanation: Bond Energy vs. Stability"}},
              "usageHint": "h3"
            }}
          }}
        }},
        {{
          "id": "videoPlayer",
          "component": {{
            "Video": {{
              "url": {{"literalString": "/assets/video.mp4"}}
            }}
          }}
        }},
        {{
          "id": "videoDescription",
          "component": {{
            "Text": {{
              "text": {{"literalString": "Watch this animated explanation of why breaking bonds requires energy and how ATP hydrolysis actually works."}},
              "usageHint": "body"
            }}
          }}
        }}
      ]
    }}
  }}
]
"""

# QuizCard template - interactive quiz cards with immediate feedback
QUIZ_EXAMPLE = f"""
Example A2UI JSON for quiz cards (interactive multiple choice with feedback):

[
  {{"beginRendering": {{"surfaceId": "{SURFACE_ID}", "root": "mainColumn"}}}},
  {{
    "surfaceUpdate": {{
      "surfaceId": "{SURFACE_ID}",
      "components": [
        {{
          "id": "mainColumn",
          "component": {{
            "Column": {{
              "children": {{"explicitList": ["headerText", "quizRow"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "headerText",
          "component": {{
            "Text": {{
              "text": {{"literalString": "Quick Quiz: ATP & Bond Energy"}},
              "usageHint": "h3"
            }}
          }}
        }},
        {{
          "id": "quizRow",
          "component": {{
            "Row": {{
              "children": {{"explicitList": ["quiz1", "quiz2"]}},
              "distribution": "start",
              "alignment": "stretch"
            }}
          }}
        }},
        {{
          "id": "quiz1",
          "component": {{
            "QuizCard": {{
              "question": {{"literalString": "What happens to energy when ATP is hydrolyzed?"}},
              "options": [
                {{"label": {{"literalString": "Energy stored in the phosphate bond is released"}}, "value": "a", "isCorrect": false}},
                {{"label": {{"literalString": "Energy is released because products are more stable"}}, "value": "b", "isCorrect": true}},
                {{"label": {{"literalString": "The bond breaking itself releases energy"}}, "value": "c", "isCorrect": false}},
                {{"label": {{"literalString": "ATP's special bonds contain more electrons"}}, "value": "d", "isCorrect": false}}
              ],
              "explanation": {{"literalString": "ATP hydrolysis releases energy because the products (ADP + Pi) are MORE STABLE than ATP. The phosphate groups in ATP repel each other, creating strain. When this bond is broken, the products achieve better resonance stabilization - like releasing a compressed spring."}},
              "category": {{"literalString": "Thermodynamics"}}
            }}
          }}
        }},
        {{
          "id": "quiz2",
          "component": {{
            "QuizCard": {{
              "question": {{"literalString": "Breaking a chemical bond requires or releases energy?"}},
              "options": [
                {{"label": {{"literalString": "Always releases energy"}}, "value": "a", "isCorrect": false}},
                {{"label": {{"literalString": "Always requires energy input"}}, "value": "b", "isCorrect": true}},
                {{"label": {{"literalString": "Depends on whether it's a high-energy bond"}}, "value": "c", "isCorrect": false}},
                {{"label": {{"literalString": "Neither - bonds are energy neutral"}}, "value": "d", "isCorrect": false}}
              ],
              "explanation": {{"literalString": "Breaking ANY bond REQUIRES energy (it's endothermic). This is a common MCAT trap! Energy is only released when NEW bonds FORM. Think of it like pulling apart magnets - you have to put in effort to separate them."}},
              "category": {{"literalString": "Bond Energy"}}
            }}
          }}
        }}
      ]
    }}
  }}
]
"""


def get_system_prompt(format_type: str, context: str) -> str:
    """
    Generate the system prompt for A2UI generation.

    Args:
        format_type: Type of content to generate (flashcards, audio, video, quiz)
        context: The learner context data

    Returns:
        System prompt for the LLM
    """
    examples = {
        "flashcards": FLASHCARD_EXAMPLE,
        "audio": AUDIO_EXAMPLE,
        "podcast": AUDIO_EXAMPLE,
        "video": VIDEO_EXAMPLE,
        "quiz": QUIZ_EXAMPLE,
    }

    example = examples.get(format_type.lower(), FLASHCARD_EXAMPLE)

    if format_type.lower() == "flashcards":
        return f"""You are creating MCAT study flashcards for Maria, a pre-med student.

## Maria's Profile
{context}

## Your Task
Create 4-5 high-quality flashcards about ATP and bond energy that:
1. Directly address her misconception that "energy is stored in bonds"
2. Use sports/gym analogies she loves (compressed springs, holding planks, etc.)
3. Are MCAT exam-focused with precise scientific language
4. Have COMPLETE, THOUGHTFUL answers - not placeholders or vague hints

## Flashcard Quality Standards
GOOD flashcard back:
"Breaking ANY chemical bond requires energy input - it's endothermic. When ATP is hydrolyzed, the energy released comes from the products (ADP + Pi) being MORE STABLE than ATP. Think of it like releasing a compressed spring - the spring doesn't 'contain' energy, it's just in a high-energy state."

BAD flashcard back:
"Energy is released because products are more stable." (too vague)
"Think of ATP like a gym analogy..." (incomplete placeholder)

## A2UI JSON Format
{example}

## Rules
- Output ONLY valid JSON - no markdown, no explanation
- Use surfaceId: "{SURFACE_ID}"
- Each card needs unique id (card1, card2, etc.)
- Front: Clear question that tests understanding
- Back: Complete explanation with analogy where helpful
- Category: One of "Biochemistry", "Chemistry", "MCAT Concept", "Common Trap"

Generate the flashcards JSON:"""

    if format_type.lower() == "quiz":
        return f"""You are creating MCAT practice quiz questions for Maria, a pre-med student.

## Maria's Profile
{context}

## Your Task
Create 2-3 interactive quiz questions about ATP and bond energy that:
1. Test her understanding of WHY ATP hydrolysis releases energy
2. Include plausible wrong answers that reflect common misconceptions
3. Provide detailed explanations using sports/gym analogies she loves
4. Are MCAT exam-style with precise scientific language

## QuizCard Component Structure
Each QuizCard must have:
- question: The question text
- options: Array of 4 choices, each with label, value (a/b/c/d), and isCorrect (true/false)
- explanation: Detailed explanation shown after answering
- category: Topic category like "Thermodynamics", "Bond Energy", "MCAT Concept"

## A2UI JSON Format
{example}

## Rules
- Output ONLY valid JSON - no markdown, no explanation
- Use surfaceId: "{SURFACE_ID}"
- Each quiz card needs unique id (quiz1, quiz2, etc.)
- Exactly ONE option per question should have isCorrect: true
- Wrong answers should be plausible misconceptions students commonly have
- Explanations should be thorough and include analogies

Generate the quiz JSON:"""

    return f"""You are an A2UI content generator for personalized learning materials.

## Learner Context
{context}

## Output Format
Output valid A2UI JSON starting with beginRendering.

## Template for {format_type}:
{example}

## Rules:
1. Use surfaceId: "{SURFACE_ID}"
2. Address the learner's specific misconceptions
3. Use sports/gym analogies for Maria
4. Output ONLY valid JSON
5. All component IDs must be unique

Generate the A2UI JSON:"""
