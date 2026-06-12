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
Personalized Learning Agent (ADK)

ADK agent that generates A2UI JSON for personalized learning materials
based on learner context data.

This agent is designed to be run with `adk web` locally or deployed
to Agent Engine.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional, Tuple

# Load environment variables from .env file for local development
# In Agent Engine, these will be set by the deployment environment
try:
  from dotenv import load_dotenv
  # Try multiple possible .env locations
  env_paths = [
      Path(__file__).parent.parent / ".env",  # samples/personalized_learning/.env
      Path(__file__).parent / ".env",  # agent/.env
      Path.cwd() / ".env",  # current working directory
  ]
  for env_path in env_paths:
    if env_path.exists():
      load_dotenv(env_path)
      break
except ImportError:
  # python-dotenv not available (e.g., in Agent Engine)
  pass

# Set up Vertex AI environment - only if not already set
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")

from google.adk.agents import Agent
from google.adk.tools import ToolContext

# Captured at import time for cloudpickle serialization during deployment
_CONFIG_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
_CONFIG_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

# Use relative imports - required for proper wheel packaging and Agent Engine deployment
# These may fail in Agent Engine where files aren't available
try:
  from .context_loader import get_combined_context, load_context_file
  from .a2ui_templates import get_system_prompt, SURFACE_ID as _IMPORTED_SURFACE_ID
  from .openstax_content import fetch_content_for_topic

  _HAS_EXTERNAL_MODULES = True
  _HAS_OPENSTAX = True
except Exception as e:
  _HAS_EXTERNAL_MODULES = False
  _HAS_OPENSTAX = False
  _IMPORT_ERROR = str(e)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Log errors for missing modules (these are required, not optional)
if not _HAS_EXTERNAL_MODULES:
  logger.error(
      "Required modules (context_loader, a2ui_templates) not available. "
      "Import error: %s",
      _IMPORT_ERROR if "_IMPORT_ERROR" in globals() else "unknown",
  )

if not _HAS_OPENSTAX:
  logger.error(
      "OpenStax content modules not available. "
      "Flashcards and quizzes will not have textbook source material."
  )

# Model configuration - use Gemini 2.5 Flash (available in us-central1)
MODEL_ID = os.getenv("GENAI_MODEL", "gemini-2.5-flash")

# Supported content formats
SUPPORTED_FORMATS = ["flashcards", "audio", "podcast", "video", "quiz"]

# Surface ID for A2UI rendering (use imported value if available, else fallback)
SURFACE_ID = _IMPORTED_SURFACE_ID if _HAS_EXTERNAL_MODULES else "learningContent"


# Context cache with TTL for performance
_CONTEXT_CACHE: dict[str, Tuple[str, float]] = {}
_CONTEXT_CACHE_TTL = 300  # 5 minutes


def _get_cached_context() -> str:
  """
  Get combined context with TTL-based caching.

  This avoids 6 GCS reads per request by caching the combined context
  for 5 minutes. The cache is invalidated after TTL expires.
  """
  cache_key = "combined_context"
  now = time.time()

  if cache_key in _CONTEXT_CACHE:
    content, cached_at = _CONTEXT_CACHE[cache_key]
    if now - cached_at < _CONTEXT_CACHE_TTL:
      logger.info("Using cached learner context (cache hit)")
      return content

  # Cache miss - load fresh
  content = _safe_get_combined_context()
  _CONTEXT_CACHE[cache_key] = (content, now)
  logger.info("Loaded and cached learner context (cache miss)")
  return content


def clear_context_cache() -> None:
  """Clear the context cache. Useful for testing."""
  global _CONTEXT_CACHE
  _CONTEXT_CACHE = {}
  logger.info("Context cache cleared")


def _safe_get_combined_context() -> str:
  """
  Get combined learner context. Uses context_loader which handles
  local files (for development) and GCS fallback (for Agent Engine).
  """
  if not _HAS_EXTERNAL_MODULES:
    raise RuntimeError(
        "context_loader module not available. Cannot load learner context."
    )

  try:
    context = get_combined_context()
    if context:
      return context
  except Exception as e:
    logger.error(f"Failed to load learner context: {e}")
    raise RuntimeError(f"Could not load learner context: {e}")

  raise RuntimeError(
      "No learner context found. Ensure context files exist in "
      "learner_context/ or GCS bucket is configured."
  )


def _safe_load_context_file(filename: str) -> Optional[str]:
  """
  Load a single context file. Uses context_loader which handles
  local files and GCS fallback.
  """
  if not _HAS_EXTERNAL_MODULES:
    logger.warning(f"context_loader not available, cannot load {filename}")
    return None

  try:
    return load_context_file(filename)
  except Exception as e:
    logger.warning(f"Failed to load {filename}: {e}")
    return None


def _safe_get_system_prompt(format_type: str, context: str) -> str:
  """Get system prompt from a2ui_templates module."""
  if not _HAS_EXTERNAL_MODULES:
    raise RuntimeError(
        "a2ui_templates module not available. "
        "Cannot generate system prompts without it."
    )
  return get_system_prompt(format_type, context)


async def generate_flashcards(
    tool_context: ToolContext,
    topic: Optional[str] = None,
) -> dict[str, Any]:
  """
  Generate personalized flashcard content as A2UI JSON.

  Creates study flashcards tailored to the learner's profile, addressing
  their misconceptions and using their preferred learning analogies.
  Content is sourced from OpenStax Biology for AP Courses textbook.

  Args:
      topic: Optional topic focus (e.g., "bond energy", "ATP hydrolysis").
             If not provided, generates general flashcards based on learner profile.

  Returns:
      A2UI JSON for flashcard components that can be rendered in the chat
  """
  logger.info(f"Generating flashcards for topic: {topic or '(none)'}")

  # Get learner context (profile, preferences, misconceptions) - uses cache
  learner_context = _get_cached_context()

  # Fetch OpenStax content for the topic
  openstax_content = ""
  sources = []
  if topic and _HAS_OPENSTAX:
    logger.info(f"Fetching OpenStax content for topic: {topic}")
    try:
      content_result = await fetch_content_for_topic(topic, max_chapters=2)
      openstax_content = content_result.get("combined_content", "")
      sources = content_result.get("sources", [])
      matched_chapters = content_result.get("matched_chapters", [])
      logger.info(
          f"OpenStax: matched {len(matched_chapters)} chapters, {len(openstax_content)}"
          " chars"
      )
      if not openstax_content:
        logger.warning("NO CONTENT RETURNED from OpenStax fetch!")
    except Exception as e:
      logger.error(f"FAILED to fetch OpenStax content: {e}")
      import traceback

      logger.error(traceback.format_exc())

  # Combine learner context with OpenStax source material
  if openstax_content:
    context = f"""## Learner Profile & Preferences
{learner_context}

## Source Material (OpenStax Biology for AP Courses)
Use the following textbook content as the authoritative source for creating flashcards:

{openstax_content}

## User's Topic Request
{topic or 'general biology concepts'}
"""
  else:
    context = learner_context
    if topic:
      context = f"{context}\n\nUser requested focus: {topic}"

  result = await _generate_a2ui_content("flashcards", context, tool_context)

  # Add source attribution
  if sources:
    result["sources"] = sources

  return result


async def generate_quiz(
    tool_context: ToolContext,
    topic: Optional[str] = None,
) -> dict[str, Any]:
  """
  Generate personalized quiz questions as A2UI JSON.

  Creates interactive multiple-choice quiz cards with immediate feedback,
  targeting the learner's specific misconceptions.
  Content is sourced from OpenStax Biology for AP Courses textbook.

  Args:
      topic: Optional topic focus (e.g., "thermodynamics", "cellular respiration").
             If not provided, generates quiz based on learner's weak areas.

  Returns:
      A2UI JSON for interactive QuizCard components
  """
  logger.info(f"Generating quiz for topic: {topic or 'general'}")

  # Get learner context (profile, preferences, misconceptions) - uses cache
  learner_context = _get_cached_context()

  # Fetch OpenStax content for the topic
  openstax_content = ""
  sources = []
  if topic and _HAS_OPENSTAX:
    try:
      content_result = await fetch_content_for_topic(topic, max_chapters=2)
      openstax_content = content_result.get("combined_content", "")
      sources = content_result.get("sources", [])
      logger.info(f"Fetched OpenStax content from {len(sources)} chapters")
    except Exception as e:
      logger.warning(f"Failed to fetch OpenStax content: {e}")

  # Combine learner context with OpenStax source material
  if openstax_content:
    context = f"""## Learner Profile & Preferences
{learner_context}

## Source Material (OpenStax Biology for AP Courses)
Use the following textbook content as the authoritative source for creating quiz questions.
Ensure all correct answers are factually accurate according to this source:

{openstax_content}

## User's Topic Request
{topic or 'general biology concepts'}
"""
  else:
    context = learner_context
    if topic:
      context = f"{context}\n\nUser requested focus: {topic}"

  result = await _generate_a2ui_content("quiz", context, tool_context)

  # Add source attribution
  if sources:
    result["sources"] = sources

  return result


async def get_audio_content(
    tool_context: ToolContext,
) -> dict[str, Any]:
  """
  Get pre-generated podcast/audio content as A2UI JSON.

  Returns A2UI JSON for an audio player with a personalized podcast
  that explains ATP and bond energy concepts using the learner's
  preferred analogies.

  Returns:
      A2UI JSON for AudioPlayer component with podcast content
  """
  logger.info("Getting audio content")

  a2ui = [
      {"beginRendering": {"surfaceId": SURFACE_ID, "root": "audioCard"}},
      {
          "surfaceUpdate": {
              "surfaceId": SURFACE_ID,
              "components": [
                  {
                      "id": "audioCard",
                      "component": {"Card": {"child": "audioContent"}},
                  },
                  {
                      "id": "audioContent",
                      "component": {
                          "Column": {
                              "children": {
                                  "explicitList": [
                                      "audioHeader",
                                      "audioPlayer",
                                      "audioDescription",
                                  ]
                              },
                              "distribution": "start",
                              "alignment": "stretch",
                          }
                      },
                  },
                  {
                      "id": "audioHeader",
                      "component": {
                          "Row": {
                              "children": {"explicitList": ["audioIcon", "audioTitle"]},
                              "distribution": "start",
                              "alignment": "center",
                          }
                      },
                  },
                  {
                      "id": "audioIcon",
                      "component": {"Icon": {"name": {"literalString": "podcasts"}}},
                  },
                  {
                      "id": "audioTitle",
                      "component": {
                          "Text": {
                              "text": {
                                  "literalString": (
                                      "ATP & Chemical Stability: Correcting the"
                                      " Misconception"
                                  )
                              },
                              "usageHint": "h3",
                          }
                      },
                  },
                  {
                      "id": "audioPlayer",
                      "component": {
                          "AudioPlayer": {
                              "url": {"literalString": "/assets/podcast.m4a"},
                              "audioTitle": {
                                  "literalString": "Understanding ATP Energy Release"
                              },
                              "audioDescription": {
                                  "literalString": (
                                      "A personalized podcast about ATP and chemical"
                                      " stability"
                                  )
                              },
                          }
                      },
                  },
                  {
                      "id": "audioDescription",
                      "component": {
                          "Text": {
                              "text": {
                                  "literalString": (
                                      "This personalized podcast explains why 'energy"
                                      " stored in bonds' is a common misconception."
                                      " Using your preferred gym analogies, it walks"
                                      " through how ATP hydrolysis actually releases"
                                      " energy through stability differences, not bond"
                                      " breaking. Perfect for your MCAT prep!"
                                  )
                              },
                              "usageHint": "body",
                          }
                      },
                  },
              ],
          }
      },
  ]

  return {
      "format": "audio",
      "a2ui": a2ui,
      "surfaceId": SURFACE_ID,
  }


async def get_video_content(
    tool_context: ToolContext,
) -> dict[str, Any]:
  """
  Get pre-generated video content as A2UI JSON.

  Returns A2UI JSON for a video player with an animated explainer
  about ATP energy and stability using visual analogies.

  Returns:
      A2UI JSON for Video component with educational content
  """
  logger.info("Getting video content")

  a2ui = [
      {"beginRendering": {"surfaceId": SURFACE_ID, "root": "videoCard"}},
      {
          "surfaceUpdate": {
              "surfaceId": SURFACE_ID,
              "components": [
                  {
                      "id": "videoCard",
                      "component": {"Card": {"child": "videoContent"}},
                  },
                  {
                      "id": "videoContent",
                      "component": {
                          "Column": {
                              "children": {
                                  "explicitList": [
                                      "videoTitle",
                                      "videoPlayer",
                                      "videoDescription",
                                  ]
                              },
                              "distribution": "start",
                              "alignment": "stretch",
                          }
                      },
                  },
                  {
                      "id": "videoTitle",
                      "component": {
                          "Text": {
                              "text": {
                                  "literalString": (
                                      "Visual Guide: ATP Energy & Stability"
                                  )
                              },
                              "usageHint": "h3",
                          }
                      },
                  },
                  {
                      "id": "videoPlayer",
                      "component": {
                          "Video": {
                              "url": {"literalString": "/assets/video.mp4"},
                          }
                      },
                  },
                  {
                      "id": "videoDescription",
                      "component": {
                          "Text": {
                              "text": {
                                  "literalString": (
                                      "This animated explainer uses the compressed"
                                      " spring analogy to show why ATP releases energy."
                                      " See how electrostatic repulsion in ATP makes it"
                                      " 'want' to become the more stable ADP + Pi."
                                  )
                              },
                              "usageHint": "body",
                          }
                      },
                  },
              ],
          }
      },
  ]

  return {
      "format": "video",
      "a2ui": a2ui,
      "surfaceId": SURFACE_ID,
  }


async def get_learner_profile(
    tool_context: ToolContext,
) -> dict[str, Any]:
  """
  Get the current learner's profile and context.

  Returns the learner's profile including their learning preferences,
  current misconceptions, and study goals. Use this to understand
  who you're helping before generating content.

  Returns:
      Learner profile with preferences, misconceptions, and goals
  """
  logger.info("Getting learner profile")

  profile = _safe_load_context_file("01_maria_learner_profile.txt")
  misconceptions = _safe_load_context_file("05_misconception_resolution.txt")

  return {
      "profile": profile or "No profile loaded",
      "misconceptions": misconceptions or "No misconception data loaded",
      "supported_formats": SUPPORTED_FORMATS,
  }


async def get_textbook_content(
    tool_context: ToolContext,
    topic: str,
) -> dict[str, Any]:
  """
  Fetch relevant OpenStax textbook content for a biology topic.

  Use this tool when the user asks a general biology question that needs
  accurate, sourced information. This fetches actual textbook content
  from OpenStax Biology for AP Courses.

  Args:
      topic: The biology topic to look up (e.g., "photosynthesis",
             "endocrine system", "DNA replication")

  Returns:
      Textbook content with source citations
  """
  logger.info(f"Fetching textbook content for: {topic}")

  if not _HAS_OPENSTAX:
    return {
        "error": "OpenStax content module not available",
        "topic": topic,
    }

  try:
    content_result = await fetch_content_for_topic(topic, max_chapters=3)

    return {
        "topic": topic,
        "matched_chapters": content_result.get("matched_chapters", []),
        "content": content_result.get("combined_content", ""),
        "sources": content_result.get("sources", []),
    }

  except Exception as e:
    logger.error(f"Failed to fetch textbook content: {e}")
    return {
        "error": str(e),
        "topic": topic,
    }


async def _generate_a2ui_content(
    format_type: str,
    context: str,
    tool_context: ToolContext,
) -> dict[str, Any]:
  """Generate A2UI content using the Gemini model."""
  from google import genai
  from google.genai import types

  project = _CONFIG_PROJECT or os.getenv("GOOGLE_CLOUD_PROJECT")
  location = _CONFIG_LOCATION or os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

  if not project:
    logger.error("GOOGLE_CLOUD_PROJECT not configured")
    return {
        "error": (
            "GOOGLE_CLOUD_PROJECT not configured. Set it in environment or deploy.py."
        )
    }

  client = genai.Client(
      vertexai=True,
      project=project,
      location=location,
  )

  system_prompt = _safe_get_system_prompt(format_type, context)

  try:
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=f"Generate {format_type} for this learner.",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
        ),
    )

    response_text = response.text.strip()

    try:
      a2ui_json = json.loads(response_text)
      logger.info(f"Successfully generated {format_type} A2UI JSON")
      return {
          "format": format_type,
          "a2ui": a2ui_json,
          "surfaceId": SURFACE_ID,
      }
    except json.JSONDecodeError as e:
      logger.error(f"Failed to parse A2UI JSON: {e}")
      return {
          "error": "Failed to generate valid A2UI JSON",
          "raw_response": response_text[:1000],
      }

  except Exception as e:
    logger.error(f"Error generating content: {e}")
    return {"error": str(e)}


# System prompt for tool selection and agent behavior
SYSTEM_PROMPT = """# Personalized Learning Agent

You are a personalized learning assistant that helps students study biology more effectively.
You generate interactive learning materials tailored to each learner's profile,
addressing their specific misconceptions and using their preferred learning styles.

**All content is sourced from OpenStax Biology for AP Courses**, a free peer-reviewed
college textbook. Your tools fetch actual textbook content to ensure accuracy.

## Your Capabilities

You can generate several types of learning content:

1. **Flashcards** - Interactive study cards based on textbook content
2. **Quiz Questions** - Multiple choice questions with detailed explanations
3. **Audio Content** - Personalized podcast explaining concepts
4. **Video Content** - Animated visual explanations
5. **Textbook Content** - Look up specific topics from OpenStax

## Current Learner

You're helping Maria, a pre-med student preparing for the MCAT. She:
- Loves sports/gym analogies for learning
- Has a misconception about "energy stored in bonds"
- Needs to understand ATP hydrolysis correctly
- Prefers visual and kinesthetic learning

## How to Respond

When a user asks for learning materials:

1. First call get_learner_profile() if you need more context about the learner
2. Use the appropriate generation tool based on what they request:
   - "flashcards" or "study cards" -> generate_flashcards(topic="...")
   - "quiz" or "test me" or "practice questions" -> generate_quiz(topic="...")
   - "podcast" or "audio" or "listen" -> get_audio_content()
   - "video" or "watch" or "visual" -> get_video_content()

3. For general biology questions (not requesting study materials):
   - Use get_textbook_content(topic="...") to fetch relevant textbook content
   - Answer the question using the fetched content
   - Always cite the source chapter

4. The tools return A2UI JSON which will be rendered as interactive components
5. After calling a tool, briefly explain what you've generated

## Content Sources

All flashcards, quizzes, and answers are generated from actual OpenStax textbook content.
When you answer questions or generate materials, you should mention the source, e.g.:
"Based on OpenStax Biology Chapter 6.4: ATP - Adenosine Triphosphate..."

## Important Notes

- Always use the learner's preferred analogies (sports/gym for Maria)
- Focus on correcting misconceptions, not just presenting facts
- Be encouraging and supportive
- The A2UI components are rendered automatically - just call the tools
- Include the topic parameter when generating flashcards or quizzes

## A2UI Format

The tools return A2UI JSON that follows this structure:
- beginRendering: Starts a new UI surface
- surfaceUpdate: Contains component definitions
- Components include: Card, Column, Row, Text, Flashcard, QuizCard, AudioPlayer, Video

You don't need to understand the A2UI format in detail - just use the tools
and explain the content to the learner.
"""


def create_agent() -> Agent:
  """Create the ADK agent with all tools."""
  return Agent(
      name="personalized_learning_agent",
      model=MODEL_ID,
      instruction=SYSTEM_PROMPT,
      tools=[
          generate_flashcards,
          generate_quiz,
          get_audio_content,
          get_video_content,
          get_learner_profile,
          get_textbook_content,
      ],
  )


# Module-level agent for local development with `adk web`
root_agent = create_agent()
