import { describe, expect, it } from 'vitest';
import { roomSettingsSchema, updateSettingsSchema } from './schemas.js';

describe('room settings patches', () => {
  it('does not reset unrelated values when a formation or budget changes', () => {
    expect(updateSettingsSchema.parse({ formation: '4-4-2' })).toEqual({ formation: '4-4-2' });
    expect(updateSettingsSchema.parse({ budgetEUR: 1_000_000_000 })).toEqual({
      budgetEUR: 1_000_000_000,
    });
    expect(updateSettingsSchema.parse({})).toEqual({});
  });
  it('keeps initial defaults while validating explicit patch values', () => {
    expect(roomSettingsSchema.parse({}).budgetEUR).toBe(750_000_000);
    expect(updateSettingsSchema.safeParse({ budgetEUR: 0 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ formation: '8-0-2' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ unknown: true }).success).toBe(false);
  });
});
