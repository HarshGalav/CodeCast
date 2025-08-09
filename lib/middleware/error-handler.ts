import { NextResponse } from 'next/server'
import { ValidationError } from '@/lib/validation/room-validation'
import { z } from 'zod'

export interface APIError {
  code: string
  message: string
  details?: any
  statusCode: number
}

export class APIErrorHandler {
  static createError(code: string, message: string, statusCode: number = 500): APIError {
    return { code, message, statusCode }
  }

  static handleError(error: any): NextResponse {
    console.error('API Error:', error)

    // Validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          message: error.message,
          field: error.field,
          code: error.code,
        },
        { status: 400 }
      )
    }

    // Zod validation errors
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      return NextResponse.json(
        {
          error: 'Validation failed',
          message: firstError.message,
          field: firstError.path.join('.'),
          code: firstError.code,
        },
        { status: 400 }
      )
    }

    // Known application errors
    if (error instanceof Error) {
      switch (error.message) {
        case 'Room not found':
          return NextResponse.json(
            {
              error: 'Room not found',
              message: 'The requested room does not exist or has expired',
              code: 'ROOM_NOT_FOUND',
            },
            { status: 404 }
          )

        case 'Room is archived and no longer available':
          return NextResponse.json(
            {
              error: 'Room archived',
              message: 'This room has been archived and is no longer available',
              code: 'ROOM_ARCHIVED',
            },
            { status: 410 }
          )

        case 'Failed to create room':
        case 'Failed to join room':
        case 'Failed to leave room':
        case 'Failed to update room snapshot':
          return NextResponse.json(
            {
              error: 'Operation failed',
              message: error.message,
              code: 'OPERATION_FAILED',
            },
            { status: 500 }
          )
      }
    }

    // Database errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        {
          error: 'Conflict',
          message: 'A record with this data already exists',
          code: 'DUPLICATE_RECORD',
        },
        { status: 409 }
      )
    }

    if (error.code === 'P2025') {
      return NextResponse.json(
        {
          error: 'Not found',
          message: 'The requested record was not found',
          code: 'RECORD_NOT_FOUND',
        },
        { status: 404 }
      )
    }

    // Generic server error
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    )
  }
}

// Rate limiting error
export class RateLimitError extends Error {
  constructor(message: string = 'Too many requests') {
    super(message)
    this.name = 'RateLimitError'
  }
}

// Authentication error
export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

// Authorization error
export class AuthorizationError extends Error {
  constructor(message: string = 'Insufficient permissions') {
    super(message)
    this.name = 'AuthorizationError'
  }
}