import { ExecutionService } from '@/lib/services/execution-service';
import { getRedisClient } from '@/lib/config/redis-config';

export class JobProcessor {
  private static instance: JobProcessor;
  private executionService: ExecutionService;
  private timeoutInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  private constructor() {
    this.executionService = ExecutionService.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): JobProcessor {
    if (!JobProcessor.instance) {
      JobProcessor.instance = new JobProcessor();
    }
    return JobProcessor.instance;
  }

  /**
   * Start background processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Job processor is already running');
      return;
    }

    console.log('Starting job processor...');
    this.isRunning = true;

    // Start timeout monitoring (every 30 seconds)
    this.timeoutInterval = setInterval(async () => {
      try {
        await this.executionService.handleTimeouts();
      } catch (error) {
        console.error('Error handling timeouts:', error);
      }
    }, 30000);

    // Start cleanup process (every 10 minutes)
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.executionService.cleanup();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }, 10 * 60 * 1000);

    console.log('Job processor started successfully');
  }

  /**
   * Stop background processing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('Job processor is not running');
      return;
    }

    console.log('Stopping job processor...');
    this.isRunning = false;

    // Clear intervals
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Shutdown execution service
    await this.executionService.shutdown();

    console.log('Job processor stopped successfully');
  }

  /**
   * Get processor status
   */
  getStatus(): {
    isRunning: boolean;
    hasTimeoutMonitoring: boolean;
    hasCleanupProcess: boolean;
  } {
    return {
      isRunning: this.isRunning,
      hasTimeoutMonitoring: this.timeoutInterval !== null,
      hasCleanupProcess: this.cleanupInterval !== null,
    };
  }

  /**
   * Health check for the job processor
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    redis: boolean;
    processor: boolean;
    queueStats?: any;
  }> {
    try {
      // Check Redis connection
      const redisClient = getRedisClient();
      const redisHealthy = await redisClient.ping() === 'PONG';

      // Get queue stats
      const queueStats = await this.executionService.getQueueStats();

      return {
        healthy: redisHealthy && this.isRunning,
        redis: redisHealthy,
        processor: this.isRunning,
        queueStats,
      };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        healthy: false,
        redis: false,
        processor: this.isRunning,
      };
    }
  }
}

// Global instance for easy access
export const jobProcessor = JobProcessor.getInstance();