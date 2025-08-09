import { NextRequest } from 'next/server'
import { RateLimitError } from './error-handler'

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  keyGenerator?: (request: NextRequest) => string
}

interface RateLimitEntry {
  count: number
  resetTime: number
}

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, RateLimitEntry>()

export class RateLimiter {
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = {
      keyGenerator: (request) => this.getClientIP(request),
      ...config,
    }
  }

  async checkRateLimit(request: NextRequest): Promise<void> {
    const key = this.config.keyGenerator!(request)
    const now = Date.now()
    const windowStart = now - this.config.windowMs

    // Clean up expired entries
    this.cleanup(windowStart)

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key)
    
    if (!entry || entry.resetTime <= now) {
      // Create new entry or reset expired entry
      entry = {
        count: 1,
        resetTime: now + this.config.windowMs,
      }
      rateLimitStore.set(key, entry)
      return
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      throw new RateLimitError(
        `Rate limit exceeded. Try again in ${Math.ceil((entry.resetTime - now) / 1000)} seconds.`
      )
    }

    // Increment counter
    entry.count++
    rateLimitStore.set(key, entry)
  }

  private cleanup(windowStart: number): void {
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime <= windowStart) {
        rateLimitStore.delete(key)
      }
    }
  }

  private getClientIP(request: NextRequest): string {
    // Try to get real IP from headers (for proxies/load balancers)
    const forwarded = request.headers.get('x-forwarded-for')
    const realIP = request.headers.get('x-real-ip')
    
    if (forwarded) {
      return forwarded.split(',')[0].trim()
    }
    
    if (realIP) {
      return realIP
    }

    // Fallback to connection IP
    return request.ip || 'unknown'
  }

  // Get rate limit info for headers
  getRateLimitInfo(request: NextRequest): {
    limit: number
    remaining: number
    resetTime: number
  } {
    const key = this.config.keyGenerator!(request)
    const entry = rateLimitStore.get(key)
    const now = Date.now()

    if (!entry || entry.resetTime <= now) {
      return {
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - 1,
        resetTime: now + this.config.windowMs,
      }
    }

    return {
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime,
    }
  }
}

// Pre-configured rate limiters
export const roomCreationLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 rooms per 15 minutes per IP
})

export const roomJoinLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20, // 20 joins per minute per IP
})

export const generalAPILimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute per IP
})