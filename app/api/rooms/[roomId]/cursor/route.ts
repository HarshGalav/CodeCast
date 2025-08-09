import { NextRequest, NextResponse } from 'next/server'
import { RoomService } from '@/lib/services/room-service'
import { z } from 'zod'
import { validateRequest, ValidationError, userIdSchema } from '@/lib/validation/room-validation'

interface RouteParams {
  params: {
    roomId: string
  }
}

const updateCursorRequestSchema = z.object({
  userId: userIdSchema,
  cursorPosition: z.object({
    lineNumber: z.number().int().min(1, 'Line number must be at least 1'),
    column: z.number().int().min(0, 'Column must be at least 0'),
  }),
})

export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Validate room ID format
    const roomIdSchema = z.string().uuid('Invalid room ID format')
    const roomId = roomIdSchema.parse(params.roomId)

    // Parse and validate request body
    const body = await request.json()
    const validatedData = validateRequest(updateCursorRequestSchema, body)

    // Update participant cursor position
    await RoomService.updateParticipantCursor(
      roomId,
      validatedData.userId,
      validatedData.cursorPosition
    )

    return NextResponse.json(
      { message: 'Cursor position updated successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Update cursor error:', error)

    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      return NextResponse.json(
        {
          error: 'Invalid room ID',
          message: firstError.message,
        },
        { status: 400 }
      )
    }

    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          message: error.message,
          field: error.field,
        },
        { status: 400 }
      )
    }

    // For cursor updates, we don't want to return errors as they're not critical
    // Just log the error and return success
    return NextResponse.json(
      { message: 'Cursor position update processed' },
      { status: 200 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      message: 'Use PUT to update cursor position',
    },
    { status: 405 }
  )
}