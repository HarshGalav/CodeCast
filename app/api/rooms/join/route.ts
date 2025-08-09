import { NextRequest, NextResponse } from 'next/server'
import { RoomService } from '@/lib/services/room-service'
import { 
  validateRequest, 
  joinRoomRequestSchema, 
  generateUserId 
} from '@/lib/validation/room-validation'
import { roomJoinLimiter } from '@/lib/middleware/rate-limiter'
import { APIErrorHandler, RateLimitError } from '@/lib/middleware/error-handler'

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    await roomJoinLimiter.checkRateLimit(request)

    // Parse and validate request body
    const body = await request.json()
    const validatedData = validateRequest(joinRoomRequestSchema, body)

    // Generate user ID if not provided
    const userId = validatedData.userId || generateUserId()

    // Join room
    const joinData = await RoomService.joinRoom(validatedData.roomKey, userId)

    // Add rate limit headers
    const rateLimitInfo = roomJoinLimiter.getRateLimitInfo(request)
    const response = NextResponse.json({
      ...joinData,
      userId, // Include the generated/provided user ID
    }, { status: 200 })
    
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
      message: 'Use POST to join a room',
    },
    { status: 405 }
  )
}