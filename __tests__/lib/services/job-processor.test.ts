import { JobProcessor } from '@/lib/services/job-processor';
import { ExecutionService } from '@/lib/services/execution-service';

// Mock dependencies
jest.mock('@/lib/services/execution-service');
jest.mock('@/lib/config/redis-config', () => ({
  getRedisClient: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
}));

const mockExecutionService = ExecutionService as jest.Mocked<typeof ExecutionService>;

// Mock timers
jest.useFakeTimers();

describe('JobProcessor', () => {
  let jobProcessor: JobProcessor;
  let mockExecutionServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockExecutionServiceInstance = {
      handleTimeouts: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getQueueStats: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      }),
    };

    mockExecutionService.getInstance.mockReturnValue(mockExecutionServiceInstance);
    jobProcessor = JobProcessor.getInstance();
  });

  afterEach(async () => {
    await jobProcessor.stop();
    jest.clearAllTimers();
  });

  describe('start', () => {
    it('should start the job processor successfully', async () => {
      await jobProcessor.start();

      const status = jobProcessor.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.hasTimeoutMonitoring).toBe(true);
      expect(status.hasCleanupProcess).toBe(true);
    });

    it('should not start if already running', async () => {
      await jobProcessor.start();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await jobProcessor.start();

      expect(consoleSpy).toHaveBeenCalledWith('Job processor is already running');
      consoleSpy.mockRestore();
    });

    it('should handle timeout monitoring', async () => {
      await jobProcessor.start();

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);

      expect(mockExecutionServiceInstance.handleTimeouts).toHaveBeenCalled();
    });

    it('should handle cleanup process', async () => {
      await jobProcessor.start();

      // Fast-forward 10 minutes
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(mockExecutionServiceInstance.cleanup).toHaveBeenCalled();
    });

    it('should handle timeout monitoring errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockExecutionServiceInstance.handleTimeouts.mockRejectedValue(new Error('Timeout error'));

      await jobProcessor.start();

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error handling timeouts:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('should handle cleanup errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockExecutionServiceInstance.cleanup.mockRejectedValue(new Error('Cleanup error'));

      await jobProcessor.start();

      // Fast-forward 10 minutes
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during cleanup:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('should stop the job processor successfully', async () => {
      await jobProcessor.start();
      await jobProcessor.stop();

      const status = jobProcessor.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.hasTimeoutMonitoring).toBe(false);
      expect(status.hasCleanupProcess).toBe(false);
      expect(mockExecutionServiceInstance.shutdown).toHaveBeenCalled();
    });

    it('should not stop if not running', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await jobProcessor.stop();

      expect(consoleSpy).toHaveBeenCalledWith('Job processor is not running');
      consoleSpy.mockRestore();
    });
  });

  describe('getStatus', () => {
    it('should return correct status when stopped', () => {
      const status = jobProcessor.getStatus();

      expect(status).toEqual({
        isRunning: false,
        hasTimeoutMonitoring: false,
        hasCleanupProcess: false,
      });
    });

    it('should return correct status when running', async () => {
      await jobProcessor.start();
      const status = jobProcessor.getStatus();

      expect(status).toEqual({
        isRunning: true,
        hasTimeoutMonitoring: true,
        hasCleanupProcess: true,
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when everything is working', async () => {
      await jobProcessor.start();
      const health = await jobProcessor.healthCheck();

      expect(health).toEqual({
        healthy: true,
        redis: true,
        processor: true,
        queueStats: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
      });
    });

    it('should return unhealthy status when Redis is down', async () => {
      const { getRedisClient } = require('@/lib/config/redis-config');
      getRedisClient.mockReturnValue({
        ping: jest.fn().mockRejectedValue(new Error('Redis error')),
      });

      await jobProcessor.start();
      const health = await jobProcessor.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.redis).toBe(false);
      expect(health.processor).toBe(true);
    });

    it('should handle health check errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockExecutionServiceInstance.getQueueStats.mockRejectedValue(new Error('Queue error'));

      const health = await jobProcessor.healthCheck();

      expect(health.healthy).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Health check failed:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });
});