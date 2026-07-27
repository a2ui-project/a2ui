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

/**
 * Firebase Authentication for Personalized Learning Demo
 *
 * Authentication flow:
 *   1. User signs in with Google (Firebase Auth)
 *   2. Client calls server /api/check-access to verify authorization
 *   3. Server checks email against VITE_ALLOWED_DOMAIN and VITE_ALLOWED_EMAILS
 *   4. If authorized, user proceeds; if not, signed out with error
 *
 * Access control is configured via environment variables (see .env.template):
 *   - VITE_ALLOWED_DOMAIN: restrict to a domain (e.g., "yourcompany.com")
 *   - VITE_ALLOWED_EMAILS: whitelist specific emails (comma-separated)
 *
 * The SERVER is the single source of truth for authorization decisions.
 * This file only handles Firebase authentication, not authorization.
 *
 * LOCAL DEV MODE: If VITE_FIREBASE_API_KEY is not set, auth is bypassed
 * and the app runs without requiring sign-in.
 */

import {initializeApp} from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
  Auth,
} from 'firebase/auth';

// Firebase configuration - reads from environment variables set in .env
// These are populated by the Quickstart notebook or can be set manually
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Check if Firebase is configured (API key present)
export const isFirebaseConfigured = !!firebaseConfig.apiKey;

// Initialize Firebase only if configured
let app: ReturnType<typeof initializeApp> | null = null;
let auth: Auth | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} else {
  console.log('[Auth] Firebase not configured - running in local dev mode (no auth required)');
}

// Google provider
// Note: The 'hd' parameter is just a UI hint to show accounts from a specific domain.
// It does NOT enforce access - the server does that via /api/check-access.
const provider = new GoogleAuthProvider();
const hintDomain = import.meta.env.VITE_ALLOWED_DOMAIN;
if (hintDomain) {
  provider.setCustomParameters({hd: hintDomain});
}

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Get current Firebase user (if authenticated)
 * Note: This only checks Firebase auth, not server authorization
 */
export function getCurrentUser(): User | null {
  if (!auth) return null;
  return auth.currentUser;
}

/**
 * Get ID token for API requests
 * In local dev mode, returns null (API server allows unauthenticated requests locally)
 */
export async function getIdToken(): Promise<string | null> {
  if (!auth) return null;
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('[Auth] Failed to get ID token:', error);
    return null;
  }
}

/**
 * Check with server if the current user is authorized
 * This is the ONLY place authorization is checked - the server is the source of truth.
 * Returns true if authorized, false otherwise.
 */
export async function checkServerAuthorization(): Promise<boolean> {
  const token = await getIdToken();
  if (!token) return false;

  try {
    const response = await fetch('/api/check-access', {
      method: 'GET',
      headers: {Authorization: `Bearer ${token}`},
    });
    return response.ok;
  } catch (error) {
    console.error('[Auth] Server authorization check failed:', error);
    return false;
  }
}

/**
 * Sign in with Google
 * Returns user if Firebase auth succeeds, null if cancelled
 * IMPORTANT: Caller must then call checkServerAuthorization() to verify access
 */
export async function signInWithGoogle(): Promise<User | null> {
  if (!auth) {
    console.warn('[Auth] signInWithGoogle called but Firebase not configured');
    return null;
  }
  try {
    const result = await signInWithPopup(auth, provider);
    console.log(`[Auth] Firebase sign-in successful: ${result.user.email}`);
    return result.user;
  } catch (error: any) {
    if (error.code === 'auth/popup-closed-by-user') {
      console.log('[Auth] Sign-in cancelled by user');
      return null;
    }
    throw error;
  }
}

/**
 * Sign out current user
 */
export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
  console.log('[Auth] Signed out');
}

/**
 * Subscribe to auth state changes
 * Callback receives user if authenticated, null otherwise
 * Note: This only tracks Firebase auth state, not server authorization
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  // Local dev mode: no Firebase, skip auth entirely
  if (!auth) {
    setTimeout(() => callback(null), 0);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
}

/**
 * Check if user is authenticated with Firebase
 * Note: This does not check server authorization
 */
export function isAuthenticated(): boolean {
  if (!auth) return false;
  return auth.currentUser !== null;
}
