/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Chat Orchestrator
 *
 * Orchestrates the chat flow between the user, Gemini, and the A2A agent.
 * Determines when to generate A2UI content and manages async artifact generation.
 */

import {A2UIRenderer} from './a2ui-renderer';
import {A2AClient} from './a2a-client';
import {getIdToken} from './firebase-auth';

// Helper to get auth headers for API requests
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = await getIdToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

// Types for conversation history
interface Message {
  role: 'user' | 'assistant';
  content: string;
  a2ui?: unknown[];
}

// Intent types the orchestrator can detect
type Intent = 'flashcards' | 'podcast' | 'audio' | 'video' | 'quiz' | 'general' | 'greeting';

export class ChatOrchestrator {
  private conversationHistory: Message[] = [];
  private renderer: A2UIRenderer;
  private a2aClient: A2AClient;

  // System prompt for conversational responses.
  // Note: Maria's profile also appears in agent/agent.py (for content generation) and
  // learner_context/ files (for dynamic personalization). This duplication is intentional—
  // the frontend and agent operate independently and both need learner context.
  private systemPrompt = `You are a personalized MCAT tutor helping Maria, a pre-med student at Cymbal University.
You have access to her learning profile and know she struggles with understanding ATP and bond energy concepts.

CRITICAL RULE - KEEP RESPONSES SHORT:
When Maria asks for flashcards, podcasts, or videos, respond with ONLY 1-2 sentences.
The actual content (flashcards, audio player, video player) will be rendered separately by the UI system.
DO NOT write out flashcard content, podcast transcripts, or video descriptions. Just briefly acknowledge the request.

Example good responses:
- "Here are some flashcards to help you review!" (flashcards render below)
- "Great idea! Here's a podcast that explains this concept." (audio player renders below)
- "Check out this video explanation!" (video player renders below)

Example BAD responses (DO NOT DO THIS):
- Writing out "Front: ... Back: ..." for flashcards
- Writing a podcast script or transcript
- Describing video content in detail

When Maria asks a general question (not requesting materials):
1. ANSWER it directly and helpfully first
2. Use analogies she relates to (sports, gym, fitness)
3. Only AFTER explaining, you may OFFER additional resources if relevant

Key facts about Maria:
- Visual-kinesthetic learner who responds well to sports/gym analogies
- Common misconception: thinking "energy is stored in ATP bonds"
- Correct understanding: ATP releases energy because products (ADP + Pi) are MORE STABLE

CONTENT SOURCE ATTRIBUTION:
If asked about sources, say materials come from OpenStax Biology for AP Courses, a free peer-reviewed college textbook.

Keep ALL responses:
- Short and conversational (1-2 sentences for material requests, 2-3 for explanations)
- Friendly and encouraging
- NEVER include the actual content of flashcards, podcasts, or videos in your text`;

  constructor(renderer: A2UIRenderer) {
    this.renderer = renderer;
    this.a2aClient = new A2AClient();
  }

  /**
   * Process a user message and generate a response.
   * Uses combined intent+response endpoint to reduce latency.
   */
  async processMessage(userMessage: string, messageElement: HTMLDivElement): Promise<void> {
    // Add to history
    this.conversationHistory.push({role: 'user', content: userMessage});

    // Try combined endpoint first (single LLM call for intent + response + keywords)
    let intent: Intent;
    let responseText: string;
    let keywords: string | undefined;

    console.log('========================================');
    console.log('[Orchestrator] PROCESSING USER MESSAGE');
    console.log(`[Orchestrator] User said: "${userMessage}"`);
    console.log('========================================');

    try {
      const combinedResult = await this.getCombinedIntentAndResponse(userMessage);
      intent = combinedResult.intent as Intent;
      responseText = combinedResult.text;
      keywords = combinedResult.keywords;
      console.log('========================================');
      console.log('[Orchestrator] GEMINI RESPONSE RECEIVED');
      console.log(`[Orchestrator] Detected intent: ${intent}`);
      console.log(`[Orchestrator] Keywords: ${keywords || '(none)'}`);
      console.log(`[Orchestrator] Response text: ${responseText.substring(0, 100)}...`);
      console.log('========================================');
    } catch (error) {
      console.warn('[Orchestrator] Combined endpoint failed, falling back to separate calls');
      // Fallback to separate calls if combined endpoint fails
      intent = await this.detectIntentWithLLM(userMessage);
      console.log(`[Orchestrator] Fallback detected intent: ${intent}`);
      const response = await this.generateResponse(userMessage, intent);
      responseText = response.text;
    }

    // Update the message element with the response text
    this.setMessageText(messageElement, responseText);

    // If we need A2UI content, fetch and render it
    if (intent !== 'general' && intent !== 'greeting') {
      // Add processing placeholder
      const placeholder = this.addProcessingPlaceholder(messageElement, intent);

      try {
        // Fetch A2UI content from the agent
        // Use LLM-generated keywords if available (handles typos, adds related terms)
        // Fall back to user message + response context if keywords not available
        const topicContext = keywords
          ? keywords // Keywords are already corrected and expanded by Gemini
          : `User request: ${userMessage}\nAssistant context: ${responseText}`;

        console.log('========================================');
        console.log('[Orchestrator] CALLING AGENT ENGINE FOR A2UI CONTENT');
        console.log(`[Orchestrator] Intent (format): ${intent}`);
        console.log(`[Orchestrator] Topic context being sent:`);
        console.log(`[Orchestrator]   "${topicContext}"`);
        console.log(
          `[Orchestrator] Keywords available: ${keywords ? 'YES' : 'NO (using fallback)'}`,
        );
        console.log('========================================');

        const a2uiResult = await this.a2aClient.generateContent(intent, topicContext);

        console.log('========================================');
        console.log('[Orchestrator] AGENT ENGINE RESPONSE RECEIVED');
        console.log(`[Orchestrator] Format: ${a2uiResult?.format}`);
        console.log(`[Orchestrator] Source: ${JSON.stringify(a2uiResult?.source)}`);
        console.log(`[Orchestrator] A2UI messages: ${a2uiResult?.a2ui?.length || 0}`);
        console.log('========================================');

        // Remove placeholder
        placeholder.remove();

        // Render A2UI content with source attribution
        if (a2uiResult && a2uiResult.a2ui) {
          this.renderer.render(messageElement, a2uiResult.a2ui, a2uiResult.source);
          this.conversationHistory[this.conversationHistory.length - 1].a2ui = a2uiResult.a2ui;
        }
      } catch (error) {
        console.error('[Orchestrator] Error fetching A2UI content:', error);
        placeholder.innerHTML = `
          <span class="material-symbols-outlined" style="color: #f87171;">error</span>
          <span class="text">Failed to load content. Please try again.</span>
        `;
      }
    }

    // Add assistant response to history
    this.conversationHistory.push({role: 'assistant', content: responseText});
  }

  /**
   * Get combined intent and response in a single LLM call.
   * This reduces latency by eliminating one round-trip.
   * For content-generating intents, also returns keywords for better content retrieval.
   */
  private async getCombinedIntentAndResponse(
    message: string,
  ): Promise<{intent: string; text: string; keywords?: string}> {
    const recentContext = this.conversationHistory
      .slice(-4)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await fetch('/api/chat-with-intent', {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        systemPrompt: this.systemPrompt,
        messages: this.conversationHistory.slice(-10).map(m => ({
          role: m.role,
          parts: [{text: m.content}],
        })),
        userMessage: message,
        recentContext: recentContext,
      }),
    });

    if (!response.ok) {
      throw new Error(`Combined API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Detect the user's intent using Gemini LLM.
   * Returns the detected intent for routing to appropriate content generation.
   */
  private async detectIntentWithLLM(message: string): Promise<Intent> {
    const recentContext = this.conversationHistory
      .slice(-4)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          systemPrompt: `You are an intent classifier. Analyze the user's message and conversation context to determine their intent.

IMPORTANT: Consider the CONVERSATION CONTEXT. If the user previously discussed flashcards/podcasts/videos and says things like "yes", "sure", "do it", "render them", "show me", "ya that works" - they are CONFIRMING a previous offer.

Return ONLY ONE of these exact words (nothing else):
- flashcards - if user wants study cards, review cards, flashcards, or is confirming a flashcard offer
- podcast - if user wants audio content, podcast, or to listen to something
- video - if user wants to watch something or see a video
- quiz - if user wants to be tested or take a quiz
- greeting - if user is just saying hello/hi
- general - for questions, explanations, or general conversation

Examples:
- "make me some flashcards" → flashcards
- "f'cards please" → flashcards
- "ya that works" (after flashcard offer) → flashcards
- "render them properly" (after flashcard discussion) → flashcards
- "sure, show me" (after any content offer) → depends on what was offered
- "explain ATP" → general
- "hi there" → greeting`,
          intentGuidance: '',
          messages: [],
          userMessage: `Recent conversation:\n${recentContext}\n\nCurrent message: "${message}"\n\nIntent:`,
        }),
      });

      if (!response.ok) {
        console.warn('[Orchestrator] Intent API failed, falling back to keyword detection');
        return this.detectIntentKeyword(message);
      }

      const data = await response.json();
      const intentText = (data.text || 'general').toLowerCase().trim();

      // Map response to valid intent
      if (intentText.includes('flashcard')) return 'flashcards';
      if (intentText.includes('podcast') || intentText.includes('audio')) return 'podcast';
      if (intentText.includes('video')) return 'video';
      if (intentText.includes('quiz')) return 'quiz';
      if (intentText.includes('greeting')) return 'greeting';

      return 'general';
    } catch (error) {
      console.error('[Orchestrator] Intent detection error:', error);
      return this.detectIntentKeyword(message);
    }
  }

  /**
   * Fallback keyword-based intent detection.
   */
  private detectIntentKeyword(message: string): Intent {
    const lower = message.toLowerCase();

    if (lower.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/i)) {
      return 'greeting';
    }
    if (lower.match(/flash\s*card|study\s*card|review\s*card|f'?card/i)) {
      return 'flashcards';
    }
    if (lower.match(/podcast|audio|listen/i)) {
      return 'podcast';
    }
    if (lower.match(/video|watch/i)) {
      return 'video';
    }
    if (lower.match(/quiz|test me/i)) {
      return 'quiz';
    }
    return 'general';
  }

  /**
   * Generate the main chat response using Gemini.
   */
  private async generateResponse(userMessage: string, intent: Intent): Promise<{text: string}> {
    // Build the conversation context
    const messages = this.conversationHistory.slice(-10).map(m => ({
      role: m.role,
      parts: [{text: m.content}],
    }));

    // Add intent-specific guidance
    let intentGuidance = '';
    switch (intent) {
      case 'flashcards':
        intentGuidance =
          "The user wants flashcards. Respond with a SHORT (1-2 sentences) conversational acknowledgment. DO NOT include the flashcard content in your response - the flashcards will be rendered separately as interactive cards below your message. Just say something brief like 'Here are some flashcards to help you review!' or 'I've created some personalized flashcards for you.'";
        break;
      case 'podcast':
      case 'audio':
        intentGuidance =
          "The user wants to listen to the podcast. Respond with a SHORT (1-2 sentences) introduction. DO NOT write out the podcast transcript or script - the audio player will be rendered separately below your message. Just say something brief like 'Here's a personalized podcast about ATP!' or 'I've got a podcast that explains this with gym analogies you'll love.'";
        break;
      case 'video':
        intentGuidance =
          "The user wants to watch a video. Respond with a SHORT (1-2 sentences) introduction. DO NOT describe the video content in detail - the video player will be rendered separately below your message. Just say something brief like 'Here's a video that visualizes this concept!' or 'Check out this visual explanation.'";
        break;
      case 'quiz':
        intentGuidance =
          "The user wants a quiz. Respond with a SHORT (1-2 sentences) introduction. DO NOT include the quiz questions or answers in your response - the interactive quiz cards will be rendered separately below your message. Just say something brief like 'Let's test your knowledge!' or 'Here's a quick quiz to check your understanding.'";
        break;
      case 'greeting':
        intentGuidance =
          'The user is greeting you. Respond warmly in 1-2 sentences and briefly mention you can help with flashcards, podcasts, videos, and quizzes for their MCAT prep.';
        break;
      default:
        intentGuidance =
          'Respond helpfully but concisely (2-3 sentences max). If the question is about ATP, bond energy, or thermodynamics, provide a clear explanation and offer to create flashcards or play the podcast for deeper learning.';
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          systemPrompt: this.systemPrompt,
          intentGuidance,
          messages,
          userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return {text: data.text || data.response || "I apologize, I couldn't generate a response."};
    } catch (error) {
      console.error('[Orchestrator] Error calling chat API:', error);

      // Fallback responses based on intent
      return this.getFallbackResponse(intent);
    }
  }

  /**
   * Get a fallback response if the API fails.
   */
  private getFallbackResponse(intent: Intent): {text: string} {
    switch (intent) {
      case 'flashcards':
        return {
          text: 'Here are some personalized flashcards to help you master these concepts!',
        };
      case 'podcast':
      case 'audio':
        return {
          text: "Here's the personalized podcast I mentioned! It's designed specifically for you, Maria, using gym and fitness analogies to explain why 'energy stored in bonds' is a misconception. Perfect for listening during your workout!",
        };
      case 'video':
        return {
          text: "Let me show you this visual explanation. It uses the compressed spring analogy to demonstrate how ATP releases energy through stability differences, not by 'releasing stored energy from bonds.'",
        };
      case 'quiz':
        return {
          text: "Let's test your understanding! Here's a quick quiz on ATP and bond energy concepts.",
        };
      case 'greeting':
        return {
          text: "Hey Maria! How's the MCAT studying going? What's on your mind today?",
        };
      default:
        return {
          text: "That's a great question! Let me help you think through this.",
        };
    }
  }

  /**
   * Update the message element with text content.
   */
  private setMessageText(messageElement: HTMLDivElement, text: string): void {
    const textEl = messageElement.querySelector('.message-text');
    if (textEl) {
      textEl.innerHTML = this.parseMarkdown(text);
    }
  }

  /**
   * Simple markdown parser for chat messages.
   */
  private parseMarkdown(text: string): string {
    // Escape HTML first for security
    let html = this.escapeHtml(text);

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/g, '<em>$1</em>');

    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert bullet lists: lines starting with - or *
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Convert numbered lists: lines starting with 1. 2. etc
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Convert double newlines to paragraph breaks
    html = html.replace(/\n\n+/g, '</p><p>');

    // Convert single newlines to <br> (but not inside lists)
    html = html.replace(/(?<!<\/li>)\n(?!<)/g, '<br>');

    // Wrap in paragraph if not empty
    if (html.trim()) {
      html = `<p>${html}</p>`;
    }

    // Clean up empty paragraphs and fix list wrapping
    html = html.replace(/<p>\s*<ul>/g, '<ul>');
    html = html.replace(/<\/ul>\s*<\/p>/g, '</ul>');
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  /**
   * Add a processing placeholder for async content.
   */
  private addProcessingPlaceholder(messageElement: HTMLDivElement, intent: Intent): HTMLDivElement {
    const contentEl = messageElement.querySelector('.message-content');
    if (!contentEl) throw new Error('Message content element not found');

    const placeholder = document.createElement('div');
    placeholder.className = 'processing-card';

    const label = this.getProcessingLabel(intent);
    placeholder.innerHTML = `
      <div class="spinner"></div>
      <span class="text">${label}</span>
    `;

    contentEl.appendChild(placeholder);
    return placeholder;
  }

  /**
   * Get the processing label for an intent.
   */
  private getProcessingLabel(intent: Intent): string {
    switch (intent) {
      case 'flashcards':
        return 'Generating personalized flashcards...';
      case 'podcast':
      case 'audio':
        return 'Loading podcast...';
      case 'video':
        return 'Loading video...';
      case 'quiz':
        return 'Creating quiz questions...';
      default:
        return 'Processing...';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
