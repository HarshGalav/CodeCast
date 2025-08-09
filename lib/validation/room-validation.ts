import { z } from 'zod'

// Room key validation schema
export const roomKeySchema = z
  .string()
  .length(12, 'Room key must be exactly 12 characters')
  .regex(/^[A-Z0-9]+$/, 'Room key must contain only uppercase letters and numbers')

// User ID validation schema
export const userIdSchema = z
  .string()
  .min(1, 'User ID is required')
  .max(255, 'User ID must be less than 255 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'User ID can only contain letters, numbers, underscores, and hyphens')

// Create room request schema
export const createRoomRequestSchema = z.object({
  // No additional fields required for room creation
})

// Join room request schema
export const joinRoomRequestSchema = z.object({
  roomKey: roomKeySchema,
  userId: userIdSchema.optional(),
})

// Update room snapshot schema
export const updateRoomSnapshotSchema = z.object({
  roomId: z.string().uuid('Invalid room ID format'),
  content: z.string().max(100000, 'Code content too large (max 100KB)'),
  yjsState: z.instanceof(Uint8Array).optional(),
})

// Update cursor position schema
export const updateCursorPositionSchema = z.object({
  roomId: z.string().uuid('Invalid room ID format'),
  userId: userIdSchema,
  cursorPosition: z.object({
    lineNumber: z.number().int().min(1, 'Line number must be at least 1'),
    column: z.number().int().min(0, 'Column must be at least 0'),
  }),
})

// Validation error handler
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// Validate and parse request data
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      throw new ValidationError(
        firstError.message,
        firstError.path.join('.'),
        firstError.code
      )
    }
    throw new ValidationError('Invalid request data')
  }
}

// Sanitize user input
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 1000) // Limit length
}

// Generate user ID if not provided
export function generateUserId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `user_${timestamp}_${random}`
}