import { ExecutionService } from '@/lib/services/execution-service';
import { JobProcessor } from '@/lib/services/job-processor';
import { CompileJobRepository } from '@/lib/repositories/compile-job-repository';
import { JobStatus } from '@/lib/types/database';

// Mock external dependencies
jest.mock('@/lib/repositories/compile-job-repository');
jest.mock('@/lib/services/docker-service', () => ({
  DockerService: {
    executeCode: jest.fn().mockResolvedValue({
      success: true,
      stdout: 'Hello World',
      stderr: '',
      exitCode: 0,
      executionTime: 1500,
      timedOut: false,
    }),
  },
}));

jest.mock('@/lib/config/redis-config', () => ({
  redisConfig: {
    redis: {
      port: 6379,
      host: 'localhost',
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
    },
  },
  getRedisClient: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
  })),
}));

// Mock Bull queue
jest.mock('bull', () => {
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
    process: jest.fn(),
    getJob: jest.fn(),
    getWaiting: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getDelayed: jest.fn().mockResolvedValue([]),
    on: jest.fn(),
    clean: jest.fn().mockResolvedValue(0),
    close: jest.fn().mockResolvedValue(undefined),
  };
  
  return jest.fn().mockImplementation(() => mockQueue);
});

const mockCompileJobRepository = CompileJobRepository as jest.Mocked<typeof CompileJobRepository>;

describe('Job Queue Integration', () => {
  let executionService: ExecutionService;
  let jobProcessor: JobProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    executionService = ExecutionService.getInstance();
    jobProcessor = JobProcessor.getInstance();
  });

  afterEach(async () => {
    await jobProcessor.stop();
  });

  describe('End-to-End Job Processing', () => {
    it('should process a complete job lifecycle', async () => {
      const roomId = 'room-123';
      const userId = 'user-456';
      const code = '#include <iostream>\nint main() { std::cout << "Hello World"; return 0; }';
      const jobId = 'test-job-id';

      // Mock database operations
      mockCompileJobRepository.create.mockResolvedValue({
        id: jobId,
        roomId,
        userId,
        code,
        options: {
          flags: ['-std=c++17', '-Wall', '-Wextra'],
          timeout: 30000,
          memoryLimit: '128m',
          cpuLimit: '0.5',
        },
        status: JobStatus.QUEUED,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        stdout: null,
        stderr: null,
        exitCode: null,
        executionTime: null,
        memoryUsed: null,
      });

      mockCompileJobRepository.findByUser.mockResolvedValue([]);
      mockCompileJobRepository.findById.mockResolvedValue({
        id: jobId,
        roomId,
        userId,
        code,
        options: {},
        status: JobStatus.COMPLETED,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 1500,
        memoryUsed: null,
      });

      // 1. Queue the job
      const queuedJobId = await executionService.queueJob(roomId, userId, code);
      expect(queuedJobId).toBeDefined();
      expect(mockCompileJobRepository.create).toHaveBeenCalled();

      // 2. Check job status
      const status = await executionService.getJobStatus(jobId);
      expect(status.status).toBe(JobStatus.COMPLETED);
      expect(status.result).toBeDefined();
      expect(status.result?.success).toBe(true);
      expect(status.result?.stdout).toBe('Hello World');

      // 3. Verify queue stats
      const stats = await executionService.getQueueStats();
      expect(stats).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });

    it('should handle job cancellation', async () => {
      const roomId = 'room-123';
      const userId = 'user-456';
      const code = 'int main() { return 0; }';
      const jobId = 'test-job-id';

      mockCompileJobRepository.findById.mockResolvedValue({
        id: jobId,
        roomId,
        userId,
        code,
        options: {},
        status: JobStatus.QUEUED,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        stdout: null,
        stderr: null,
        exitCode: null,
        executionTime: null,
        memoryUsed: null,
      });

      mockCompileJobRepository.cancel.mockResolvedValue({
        id: jobId,
        roomId,
        userId,
        code,
        options: {},
        status: JobStatus.CANCELLED,
        createdAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        stdout: null,
        stderr: null,
        exitCode: null,
        executionTime: null,
        memoryUsed: null,
      });

      const cancelled = await executionService.cancelJob(jobId, userId);
      expect(cancelled).toBe(true);
      expect(mockCompileJobRepository.cancel).toHaveBeenCalledWith(jobId);
    });

    it('should handle rate limiting', async () => {
      const roomId = 'room-123';
      const userId = 'user-456';
      const code = 'int main() { return 0; }';

      // Mock recent jobs to exceed rate limit
      const recentJobs = Array(6).fill(null).map((_, i) => ({
        id: `job-${i}`,
        roomId,
        userId,
        code,
        options: {},
        status: JobStatus.COMPLETED,
        createdAt: new Date(Date.now() - 30000), // 30 seconds ago
        startedAt: new Date(),
        completedAt: new Date(),
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime: 1000,
        memoryUsed: null,
        room: {
          id: roomId,
          key: 'test-key',
          createdAt: new Date(),
          lastActivity: new Date(),
          isArchived: false,
          participantCount: 1,
          codeSnapshot: null,
          yjsState: null,
        },
      }));

      mockCompileJobRepository.findByUser.mockResolvedValue(recentJobs);

      await expect(
        executionService.queueJob(roomId, userId, code)
      ).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Job Processor Health', () => {
    it('should report healthy status when running', async () => {
      await jobProcessor.start();
      
      const health = await jobProcessor.healthCheck();
      
      expect(health.healthy).toBe(true);
      expect(health.redis).toBe(true);
      expect(health.processor).toBe(true);
      expect(health.queueStats).toBeDefined();
    });

    it('should report processor status correctly', async () => {
      // Initially stopped
      let status = jobProcessor.getStatus();
      expect(status.isRunning).toBe(false);

      // Start processor
      await jobProcessor.start();
      status = jobProcessor.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.hasTimeoutMonitoring).toBe(true);
      expect(status.hasCleanupProcess).toBe(true);

      // Stop processor
      await jobProcessor.stop();
      status = jobProcessor.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });
});