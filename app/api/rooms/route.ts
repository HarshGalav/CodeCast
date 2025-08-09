import { NextRequest, NextResponse } from 'next/server'
import { RoomService } from '@/lib/services/room-service'
import { validateRequest, createRoomRequestSchema, ValidationError } from '@/lib/validation/room-validation'
import { roomCreationLimiter } from '@/lib/middleware/rate-limiter'
import { APIErrorHandler, RateLimitError } from '@/lib/middleware/error-handler'

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    await roomCreationLimiter.checkRateLimit(request)

    // Validate request body
    const body = await request.json().catch(() => ({}))
    validateRequest(createRoomRequestSchema, body)

    // Create room
    const roomData = await RoomService.createRoom()

    // Add rate limit headers
    const rateLimitInfo = roomCreationLimiter.getRateLimitInfo(request)
    const response = NextResponse.json(roomData, { status: 201 })
    
    response.headers.set('X-RateLimit-Limit', rateLimitInfo.limit.toString())
    response.headers.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString())
    response.headers.set('X-RateLimit-Reset', rateLimitInfo.resetTime.toString())

    return response
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
        },
        { status: 429 }
      )
    }

    return APIErrorHandler.handleError(error)
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: 'Method not allowed',
      message: 'Use POST to create a room',
    },
    { status: 405 }
  )
}