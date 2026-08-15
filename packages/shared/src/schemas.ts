import { z } from 'zod';

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, 'Enter a valid six-character room code');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(24, 'Name must be 24 characters or fewer')
  .transform((value) =>
    [...value]
      .filter(
        (character) => character !== '<' && character !== '>' && character.charCodeAt(0) >= 32,
      )
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .refine((value) => value.length >= 2, 'Name contains unsupported characters');

export const avatarSchema = z
  .enum([
    'arsenal',
    'barcelona',
    'bayern-munich',
    'chelsea',
    'juventus',
    'liverpool',
    'manchester-city',
    'manchester-united',
    'psg',
    'real-madrid',
    // Retained so sessions created by older clients can still be resumed.
    'bolt',
    'crown',
    'shield',
    'star',
    'target',
    'wave',
  ])
  .default('barcelona');

export const formationNameSchema = z.enum([
  '4-2-1-3',
  '4-3-3',
  '4-2-3-1',
  '4-4-2',
  '3-4-2-1',
  '3-5-2',
  '5-2-1-2',
]);

export const budgetModeSchema = z.enum(['STRICT', 'CHAOS']);

export const roomSettingsSchema = z.object({
  formation: formationNameSchema.default('4-2-1-3'),
  budgetEUR: z.number().int().min(100_000_000).max(5_000_000_000).default(750_000_000),
  bidIncrementEUR: z.number().int().min(1_000_000).max(50_000_000).default(1_000_000),
  auctionTimerSeconds: z.number().int().min(5).max(60).default(12),
  revealSeconds: z.number().int().min(0).max(10).default(3),
  antiSnipeSeconds: z.number().int().min(0).max(15).default(5),
  soundEnabled: z.boolean().default(true),
  budgetMode: budgetModeSchema.default('CHAOS'),
  formLookback: z.enum(['5_MATCHES', '10_MATCHES', 'CURRENT_SEASON']).default('CURRENT_SEASON'),
});

export const createRoomSchema = z.object({
  name: displayNameSchema,
  avatar: avatarSchema.optional(),
});

export const joinRoomSchema = z.object({
  roomCode: roomCodeSchema,
  name: displayNameSchema,
  avatar: avatarSchema.optional(),
  sessionToken: z.string().min(20).max(512).optional(),
});

export const readySchema = z.object({ ready: z.boolean() });

export const updateSettingsSchema = roomSettingsSchema.partial().strict();

export const bidSchema = z.object({
  roomCode: roomCodeSchema,
  amountEUR: z.number().int().positive(),
  auctionSequence: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
});

export const passSchema = z.object({
  roomCode: roomCodeSchema,
  auctionSequence: z.number().int().nonnegative(),
});

export const roomActionSchema = z.object({ roomCode: roomCodeSchema });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type RoomSettingsInput = z.infer<typeof roomSettingsSchema>;
export type BidInput = z.infer<typeof bidSchema>;
export type PassInput = z.infer<typeof passSchema>;
