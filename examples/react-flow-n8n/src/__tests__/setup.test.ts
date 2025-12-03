import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Testing infrastructure', () => {
    it('should run basic tests', () => {
        expect(1 + 1).toBe(2);
    });

    it('should support fast-check property tests', () => {
        fc.assert(
            fc.property(fc.integer(), fc.integer(), (a, b) => {
                return a + b === b + a;
            }),
            { numRuns: 100 }
        );
    });
});
