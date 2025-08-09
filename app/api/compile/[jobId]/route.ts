import { NextRequest, NextResponse } from 'next/server';
import { ExecutionService } from '@/lib/services/execution-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json({
        error: 'Job ID is required',
      }, { status: 400 });
    }
    
    // Get execution service instance
    const executionService = ExecutionService.getInstance();
    
    // Get job status
    const jobStatus = await executionService.getJobStatus(jobId);
    
    return NextResponse.json({
      jobId,
      status: jobStatus.status,
      position: jobStatus.position,
      result: jobStatus.result,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Job status API error:', error);
    
    if (error instanceof Error && error.message === 'Job not found') {
      return NextResponse.json({
        error: 'Job not found',
        message: 'The specified job ID does not exist',
      }, { status: 404 });
    }
    
    return NextResponse.json({
      error: 'Internal server error',
      message: 'Failed to get job status',
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    if (!jobId) {
      return NextResponse.json({
        error: 'Job ID is required',
      }, { status: 400 });
    }
    
    if (!userId) {
      return NextResponse.json({
        error: 'User ID is required',
      }, { status: 400 });
    }
    
    // Get execution service instance
    const executionService = ExecutionService.getInstance();
    
    // Cancel the job
    const cancelled = await executionService.cancelJob(jobId, userId);
    
    if (!cancelled) {
      return NextResponse.json({
        error: 'Cannot cancel job',
        message: 'Job not found, already completed, or not owned by user',
      }, { status: 400 });
    }
    
    return NextResponse.json({
      jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully',
    });
    
  } catch (error) {
    console.error('Job cancel API error:', error);
    
    return NextResponse.json({
      error: 'Internal server error',
      message: 'Failed to cancel job',
    }, { status: 500 });
  }
}