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
 * Personalized Learning Demo - Main Entry Point
 *
 * This is the main orchestrator for the personalized learning demo.
 * It handles chat interactions, calls the A2A agent for A2UI content,
 * and renders everything in a chat-style interface.
 */

// Import A2UI web components (registers custom elements, including QuizCard)
import '@a2ui/lit/ui';

import {ChatOrchestrator} from './chat-orchestrator';
import {A2UIRenderer} from './a2ui-renderer';
import {
  onAuthChange,
  signInWithGoogle,
  signOutUser,
  getIdToken,
  isFirebaseConfigured,
  checkServerAuthorization,
} from './firebase-auth';

// Store current user for display
let currentUserEmail: string | null = null;

// Initialize the application
async function init() {
  console.log('[Demo] Initializing...');

  // Local dev mode: skip auth if Firebase not configured
  if (!isFirebaseConfigured) {
    console.log('[Demo] Running in local dev mode (no auth required)');
    currentUserEmail = 'Local Dev User';
    showApp();
    initializeApp();
    return;
  }

  // Set up auth state listener
  onAuthChange(async user => {
    if (user) {
      // User is authenticated with Firebase, now check server authorization
      console.log(`[Demo] Firebase auth OK: ${user.email}, checking server authorization...`);
      const authorized = await checkServerAuthorization();
      if (authorized) {
        currentUserEmail = user.email;
        console.log(`[Demo] Authorized: ${user.email}`);
        showApp();
        initializeApp();
      } else {
        // User authenticated but not authorized - sign them out
        console.log(`[Demo] Not authorized: ${user.email}`);
        await signOutUser();
        showLoginScreen('Your email is not authorized to access this application.');
      }
    } else {
      currentUserEmail = null;
      console.log('[Demo] Not authenticated');
      showLoginScreen();
    }
  });
}

// Show login screen
function showLoginScreen(errorMessage?: string) {
  const appContainer = document.getElementById('app-container');
  const loginScreen = document.getElementById('login-screen');

  if (appContainer) appContainer.style.display = 'none';

  if (!loginScreen) {
    // Create login screen
    const screen = document.createElement('div');
    screen.id = 'login-screen';
    screen.innerHTML = `
      <div class="login-container">
        <div class="login-card">
          <div class="login-logo">
            <span class="material-symbols-outlined">school</span>
          </div>
          <h1>Personalized Learning Demo</h1>
          <p class="login-subtitle">Sign in with your Google account to continue</p>
          <p class="login-restriction">Access restricted to authorized users</p>
          <button id="google-signin-btn" class="google-signin-btn">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
          <p id="login-error" class="login-error"></p>
        </div>
      </div>
    `;
    document.body.insertBefore(screen, document.body.firstChild);

    // Add login button handler
    document.getElementById('google-signin-btn')?.addEventListener('click', handleSignIn);
  } else {
    loginScreen.style.display = 'flex';
  }

  // Show error message if provided
  if (errorMessage) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = errorMessage;
  }
}

// Handle sign in
async function handleSignIn() {
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('google-signin-btn') as HTMLButtonElement;

  if (errorEl) errorEl.textContent = '';
  if (btn) btn.disabled = true;

  try {
    // Firebase sign-in - authorization check happens in onAuthChange listener
    const user = await signInWithGoogle();
    if (!user) {
      // User cancelled sign-in
      if (btn) btn.disabled = false;
    }
    // If sign-in succeeded, onAuthChange will handle the rest
    // (including server authorization check and showing errors if not authorized)
  } catch (error: any) {
    // Only catches Firebase errors (network issues, etc.), not authorization errors
    if (errorEl) {
      errorEl.textContent = error.message || 'Sign in failed. Please try again.';
    }
    if (btn) btn.disabled = false;
  }
}

// Show main app
function showApp() {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');

  if (loginScreen) loginScreen.style.display = 'none';
  if (appContainer) appContainer.style.display = 'flex';

  // Update user display if element exists
  const userDisplay = document.getElementById('user-email');
  if (userDisplay && currentUserEmail) {
    userDisplay.textContent = currentUserEmail;
  }
}

// Initialize the main app (called after auth)
function initializeApp() {
  // Only initialize once
  if ((window as any).__appInitialized) return;
  (window as any).__appInitialized = true;

  // Initialize the A2UI renderer
  const renderer = new A2UIRenderer();

  // Initialize the chat orchestrator
  const orchestrator = new ChatOrchestrator(renderer);

  // Set up UI event handlers
  setupEventHandlers(orchestrator);

  // Set up sign out button
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    await signOutUser();
    (window as any).__appInitialized = false;
  });

  console.log('[Demo] Ready!');
}

// Export getIdToken for use by API clients
export {getIdToken};

function setupEventHandlers(orchestrator: ChatOrchestrator) {
  const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  const chatArea = document.getElementById('chatArea') as HTMLDivElement;

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';

    // Enable/disable send button
    sendBtn.disabled = chatInput.value.trim() === '';
  });

  // Send on Enter (without Shift)
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.value.trim()) {
        sendMessage(orchestrator, chatInput, chatArea);
      }
    }
  });

  // Send on button click
  sendBtn.addEventListener('click', () => {
    if (chatInput.value.trim()) {
      sendMessage(orchestrator, chatInput, chatArea);
    }
  });

  // Handle suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input'));
        sendMessage(orchestrator, chatInput, chatArea);
      }
    });
  });
}

async function sendMessage(
  orchestrator: ChatOrchestrator,
  input: HTMLTextAreaElement,
  chatArea: HTMLDivElement,
) {
  const message = input.value.trim();
  if (!message) return;

  // Clear input
  input.value = '';
  input.style.height = 'auto';
  (document.getElementById('sendBtn') as HTMLButtonElement).disabled = true;

  // Hide welcome screen if visible
  const welcomeScreen = chatArea.querySelector('.welcome-screen');
  if (welcomeScreen) {
    welcomeScreen.remove();
  }

  // Add user message
  addUserMessage(chatArea, message);

  // Add assistant message placeholder with typing indicator
  const assistantMessage = addAssistantMessagePlaceholder(chatArea);

  // Scroll to bottom
  chatArea.scrollTop = chatArea.scrollHeight;

  try {
    // Process the message through the orchestrator
    await orchestrator.processMessage(message, assistantMessage);
  } catch (error) {
    console.error('[Demo] Error processing message:', error);
    setAssistantMessageError(
      assistantMessage,
      "I'm sorry, I encountered an error. Please try again.",
    );
  }

  // Scroll to bottom again after response
  chatArea.scrollTop = chatArea.scrollHeight;
}

function addUserMessage(chatArea: HTMLDivElement, message: string) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message user';
  messageEl.innerHTML = `
    <div class="message-avatar">M</div>
    <div class="message-content">
      <div class="message-sender">You</div>
      <div class="message-text">${escapeHtml(message)}</div>
    </div>
  `;
  chatArea.appendChild(messageEl);
}

function addAssistantMessagePlaceholder(chatArea: HTMLDivElement): HTMLDivElement {
  const messageEl = document.createElement('div');
  messageEl.className = 'message assistant';
  messageEl.innerHTML = `
    <div class="message-avatar">
      <span class="material-symbols-outlined">auto_awesome</span>
    </div>
    <div class="message-content">
      <div class="message-sender">Gemini</div>
      <div class="message-text">
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;
  chatArea.appendChild(messageEl);
  return messageEl;
}

function setAssistantMessageError(messageEl: HTMLDivElement, error: string) {
  const textEl = messageEl.querySelector('.message-text');
  if (textEl) {
    textEl.innerHTML = `<p style="color: #f87171;">${escapeHtml(error)}</p>`;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start the app
init();
