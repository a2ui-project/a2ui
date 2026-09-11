import { describe, it } from 'node:test';
import * as assert from 'node:assert';

describe('Sanity Check', () => {
  it('should pass', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
