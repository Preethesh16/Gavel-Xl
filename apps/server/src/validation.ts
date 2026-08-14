import {
  bidSchema,
  createRoomSchema,
  joinRoomSchema,
  passSchema,
  readySchema,
  roomActionSchema,
  roomCodeSchema,
  updateSettingsSchema,
} from '@gavel-xi/shared';
import { z } from 'zod';

export const resumePayloadSchema = z.object({ sessionToken: z.string().min(20).max(512) }).strict();
export const settingsPayloadSchema = z
  .object({ roomCode: roomCodeSchema, settings: updateSettingsSchema })
  .strict();
export const readyPayloadSchema = roomActionSchema.extend(readySchema.shape).strict();
export const teamRequestPayloadSchema = roomActionSchema
  .extend({ scope: z.enum(['MY', 'ALL']) })
  .strict();

export const socketSchemas = {
  'room:create': createRoomSchema.strict(),
  'room:join': joinRoomSchema.strict(),
  'room:resume': resumePayloadSchema,
  'room:settings': settingsPayloadSchema,
  'room:ready': readyPayloadSchema,
  'room:leave': roomActionSchema.strict(),
  'game:start': roomActionSchema.strict(),
  'game:restart': roomActionSchema.strict(),
  'auction:bid': bidSchema.strict(),
  'auction:pass': passSchema.strict(),
  'team:request': teamRequestPayloadSchema,
  'checkpoint:request': roomActionSchema.strict(),
  'auction:pause': roomActionSchema.strict(),
  'presence:heartbeat': roomActionSchema.strict(),
} as const;
