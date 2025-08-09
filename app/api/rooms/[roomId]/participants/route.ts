import { NextRequest, NextResponse } from 'next/server'
import { RoomService } from '@/lib/services/room-service'
import { z } from 'zod'

interface RouteParams {
  params: {
    roomId: string
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Validate room ID format
    const roomIdSchema = z.string().uuid('Invalid room ID format')
    const roomId = roomIdSchema.parse(params.roomId)

    // Get active participants
    const participants = await RoomService.getActiveParticipants(roomId)

    return NextResponse.json(
      {
        participants,
        count: participants.length,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Get participants error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid room ID',
          message: 'The room ID format is invalid',
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to retrieve participants',
      },
      { status: 500 }
    )
  }
}