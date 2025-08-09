import { NextRequest, NextResponse } from 'next/server';
import { jobProcessor } from '@/lib/services/job-processor';

export async function GET(request: NextRequest) {
  try {
    const health = await jobProcessor.healthCheck();
    
    const status = health.healthy ? 200 : 503;
    
    return NextResponse.json({
      status: health.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        redis: health.redis ? 'up' : 'down',
        processor: health.processor ? 'running' : 'stopped',
      },
      queueStats: health.queueStats,
    }, { status });
  } catch (error) {
    console.error('Queue health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 503 });
  }
}