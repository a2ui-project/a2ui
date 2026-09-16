/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect, vi} from 'vitest';
import {
  buildPermissionsPolicy,
  normalizeOrigin,
  SENSITIVE_PERMISSIONS,
  ALLOWED_REFERRER_PATTERN,
  createAllowedReferrerPattern,
  RESOURCE_READY_NOTIFICATION,
  PROXY_READY_NOTIFICATION,
} from './sandbox';

describe('mcp_apps_inner_iframe sandbox', () => {
  describe('SENSITIVE_PERMISSIONS list', () => {
    it('contains all five core sensitive browser capabilities', () => {
      expect(SENSITIVE_PERMISSIONS).toEqual([
        'camera',
        'microphone',
        'geolocation',
        'clipboard-read',
        'clipboard-write',
      ]);
    });
  });

  describe('buildPermissionsPolicy', () => {
    it('returns a full deny-all policy when allowAttribute is undefined', () => {
      const policy = buildPermissionsPolicy();
      expect(policy).toBe(
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';",
      );
    });

    it('returns a full deny-all policy when allowAttribute is empty string or whitespace', () => {
      expect(buildPermissionsPolicy('')).toBe(
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';",
      );
      expect(buildPermissionsPolicy('   ')).toBe(
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none';",
      );
    });

    it('enables a single granted permission while locking all other sensitive features to none', () => {
      const policy = buildPermissionsPolicy('camera');
      expect(policy).toContain('camera');
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
      expect(policy.startsWith('camera;')).toBe(true);
    });

    it('enables multiple granted permissions and locks unrequested sensitive features', () => {
      const policy = buildPermissionsPolicy('camera; microphone');
      expect(policy).toContain('camera');
      expect(policy).toContain('microphone');
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('preserves directive parameters and origins on granted permissions', () => {
      const policy = buildPermissionsPolicy("camera 'src'; geolocation 'self'");
      expect(policy).toContain("camera 'src'");
      expect(policy).toContain("geolocation 'self'");
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('handles case-insensitive permission directive matching', () => {
      const policy = buildPermissionsPolicy('CAMERA; Microphone');
      expect(policy).toContain('CAMERA');
      expect(policy).toContain('Microphone');
      expect(policy).not.toContain("camera 'none'");
      expect(policy).not.toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('preserves non-sensitive directives and denies all sensitive ones', () => {
      const policy = buildPermissionsPolicy('fullscreen; payment');
      expect(policy).toContain('fullscreen');
      expect(policy).toContain('payment');
      expect(policy).toContain("camera 'none'");
      expect(policy).toContain("microphone 'none'");
      expect(policy).toContain("geolocation 'none'");
      expect(policy).toContain("clipboard-read 'none'");
      expect(policy).toContain("clipboard-write 'none'");
    });

    it('does not append redundant none directives when all sensitive permissions are granted', () => {
      const allPermissions = 'camera; microphone; geolocation; clipboard-read; clipboard-write';
      const policy = buildPermissionsPolicy(allPermissions);
      expect(policy).not.toContain("'none'");
      expect(policy).toBe('camera; microphone; geolocation; clipboard-read; clipboard-write;');
    });
  });

  describe('normalizeOrigin', () => {
    it('normalizes 127.0.0.1 to localhost', () => {
      expect(normalizeOrigin('http://127.0.0.1:4200')).toBe('http://localhost:4200');
      expect(normalizeOrigin('http://127.0.0.1')).toBe('http://localhost');
      expect(normalizeOrigin('https://127.0.0.1:8443')).toBe('https://localhost:8443');
    });

    it('leaves localhost and standard domain origins unmodified', () => {
      expect(normalizeOrigin('http://localhost:4200')).toBe('http://localhost:4200');
      expect(normalizeOrigin('https://a2ui.org')).toBe('https://a2ui.org');
      expect(normalizeOrigin('https://example.com:8080')).toBe('https://example.com:8080');
    });
  });

  describe('ALLOWED_REFERRER_PATTERN and createAllowedReferrerPattern', () => {
    it('matches valid localhost and 127.0.0.1 referrers', () => {
      expect(ALLOWED_REFERRER_PATTERN.test('http://localhost:4200/')).toBe(true);
      expect(ALLOWED_REFERRER_PATTERN.test('http://localhost/app')).toBe(true);
      expect(ALLOWED_REFERRER_PATTERN.test('http://127.0.0.1:8080/')).toBe(true);
      expect(ALLOWED_REFERRER_PATTERN.test('http://127.0.0.1/')).toBe(true);
      expect(ALLOWED_REFERRER_PATTERN.test('http://localhost:4200')).toBe(true);
      expect(ALLOWED_REFERRER_PATTERN.test('http://127.0.0.1')).toBe(true);
    });

    it('rejects attacker/phishing referrers imitating localhost', () => {
      expect(ALLOWED_REFERRER_PATTERN.test('http://evil.com/localhost')).toBe(false);
      expect(ALLOWED_REFERRER_PATTERN.test('http://localhost.evil.com/')).toBe(false);
      expect(ALLOWED_REFERRER_PATTERN.test('http://127.0.0.1.attacker.org/')).toBe(false);
      expect(ALLOWED_REFERRER_PATTERN.test('https://sub.localhost.phishing.io/')).toBe(false);
    });

    it('matches configured custom host origin with boundary checks and rejects spoofing', () => {
      const customPattern = createAllowedReferrerPattern('https://a2ui.org');
      expect(customPattern.test('https://a2ui.org')).toBe(true);
      expect(customPattern.test('https://a2ui.org/')).toBe(true);
      expect(customPattern.test('https://a2ui.org:8443/app')).toBe(true);
      expect(customPattern.test('https://a2ui.org/dashboard')).toBe(true);

      // Boundary checks: rejects subdomains/prefixes spoofing the configured origin
      expect(customPattern.test('https://a2ui.org.attacker.com')).toBe(false);
      expect(customPattern.test('https://a2ui.org-phishing.com')).toBe(false);
      expect(customPattern.test('https://a2ui.org.attacker.com/path')).toBe(false);
      expect(customPattern.test('https://evil.com/?origin=https://a2ui.org')).toBe(false);
    });
  });
});
