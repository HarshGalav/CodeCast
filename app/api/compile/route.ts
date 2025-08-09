import { NextRequest, NextResponse } from 'next/server';
import { ExecutionService } from '@/lib/services/execution-service';
import { z } from 'zod';

// Request validation schema
const compileRequestSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().min(1),
  code: z.string().min(1),
  options: z.object({
    flags: z.array(z.string()).optional(),
    timeout: z.number().min(1000).max(60000).optional(),
    memoryLimit: z.string().optional(),
    cpuLimit: z.string().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    const validatedData = compileRequestSchema.parse(body);
    
    // Get execution service instance
    const executionService = ExecutionService.getInstance();
    
    // Queue the job
    const jobId = await executionService.queueJob(
      validatedData.roomId,
      validatedData.userId,
      validatedData.code,
      validatedData.options
    );
    
    return NextResponse.json({
      jobId,
      status: 'queued',
      message: 'Compilation job queued successfully',
    }, { status: 202 });
    
  } catch (error) {
    console.error('Compile API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Invalid request data',
        details: error.errors,
      }, { status: 400 });
    }
    
    if (error instanceof Error) {
      // Handle rate limiting and other service errors
      if (error.message.includes('Rate limit exceeded')) {
        return NextResponse.json({
          error: 'Rate limit exceeded',
          message: error.message,
        }, { status: 429 });
      }
      
      if (error.message.includes('Queue is full')) {
        return NextResponse.json({
          error: 'Service unavailable',
          message: error.message,
        }, { status: 503 });
      }
    }
    
    return NextResponse.json({
      error: 'Internal server error',
      message: 'Failed to queue compilation job',
    }, { status: 500 });
  }
}