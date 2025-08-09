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

    // Get room data
    const roomData = await RoomService.getRoomData(roomId)

    if (!roomData) {
      return NextResponse.json(
        {
          error: 'Room not found',
          message: 'The requested room does not exist or has been archived',
        },
        { status: 404 }
      )
    }

    return NextResponse.json(roomData, { status: 200 })
  } catch (error) {
    console.error('Get room data error:', error)

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
        message: 'Failed to retrieve room data',
      },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    // Validate room ID format
    const roomIdSchema = z.string().uuid('Invalid room ID format')
    const roomId = roomIdSchema.parse(params.roomId)

    // Parse request body
    const body = await request.json()
    
    // Validate update data
    const updateSchema = z.object({
      content: z.string().max(100000, 'Code content too large (max 100KB)'),
      yjsState: z.string().optional(), // Base64 encoded Yjs state
    })
    
    const validatedData = updateSchema.parse(body)

    // Convert base64 Yjs state to Uint8Array if provided
    let yjsState: Uint8Array | undefined
    if (validatedData.yjsState) {
      try {
        yjsState = new Uint8Array(Buffer.from(validatedData.yjsState, 'base64'))
      } catch (error) {
        return NextResponse.json(
          {
            error: 'Invalid Yjs state',
            message: 'The provided Yjs state is not valid base64',
          },
          { status: 400 }
        )
      }
    }

    // Update room snapshot
    await RoomService.updateRoomSnapshot(roomId, validatedData.content, yjsState)

    return NextResponse.json(
      { message: 'Room updated successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Update room error:', error)

    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      return NextResponse.json(
        {
          error: 'Validation failed',
          message: firstError.message,
          field: firstError.path.join('.'),
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to update room',
      },
      { status: 500 }
    )
  }
}