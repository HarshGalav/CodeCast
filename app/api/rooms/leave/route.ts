import { NextRequest, NextResponse } from 'next/server'
import { RoomService } from '@/lib/services/room-service'
import { z } from 'zod'
import { validateRequest, ValidationError, userIdSchema } from '@/lib/validation/room-validation'

const leaveRoomRequestSchema = z.object({
  roomId: z.string().uuid('Invalid room ID format'),
  userId: userIdSchema,
})

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json()
    const validatedData = validateRequest(leaveRoomRequestSchema, body)

    // Leave room
    await RoomService.leaveRoom(validatedData.roomId, validatedData.userId)

    return NextResponse.json(
      { message: 'Successfully left room' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Room leave error:', error)

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

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to leave room',
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      message: 'Use POST to leave a room',
    },
    { status: 405 }
  )
}