import { ExecutionService } from '@/lib/services/execution-service';
import { CompileJobRepository } from '@/lib/repositories/compile-job-repository';
import { DockerService } from '@/lib/services/docker-service';
import { JobStatus } from '@/lib/types/database';

// Mock dependencies
jest.mock('@/lib/repositories/compile-job-repository');
jest.mock('@/lib/services/docker-service');
jest.mock('@/lib/config/redis-config', () => ({
  redisConfig: {
    redis: {
      port: 6379,
      host: 'localhost',
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
    },
  },
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
const mockDockerService = DockerService as jest.Mocked<typeof DockerService>;

describe('ExecutionService', () => {
  let executionService: ExecutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    executionService = ExecutionService.getInstance();
  });

  describe('queueJob', () => {
    it('should queue a job successfully', async () => {
      const mockJobId = 'test-job-id';
      const roomId = 'room-123';
      const userId = 'user-456';
      const code = '#include <iostream>\nint main() { return 0; }';

      mockCompileJobRepository.create.mockResolvedValue({
        id: mockJobId,
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

      const result = await executionService.queueJob(roomId, userId, code);

      expect(result).toBeDefined();
      expect(mockCompileJobRepository.create).toHaveBeenCalledWith({
        id: expect.any(String),
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
      });
    });

    it('should throw error when rate limit is exceeded', async () => {
      const roomId = 'room-123';
      const userId = 'user-456';
      const code = '#include <iostream>\nint main() { return 0; }';

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

  describe('getJobStatus', () => {
    it('should return completed job status with result', async () => {
      const jobId = 'test-job-id';
      const mockJob = {
        id: jobId,
        roomId: 'room-123',
        userId: 'user-456',
        code: 'test code',
        options: {},
        status: JobStatus.COMPLETED,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 1500,
        memoryUsed: 1024,
      };

      mockCompileJobRepository.findById.mockResolvedValue(mockJob);

      const result = await executionService.getJobStatus(jobId);

      expect(result.status).toBe(JobStatus.COMPLETED);
      expect(result.result).toEqual({
        success: true,
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 1500,
        memoryUsed: 1024,
        timedOut: false,
      });
    });

    it('should return queued job status with position', async () => {
      const jobId = 'test-job-id';
      const mockJob = {
        id: jobId,
        roomId: 'room-123',
        userId: 'user-456',
        code: 'test code',
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
      };

      mockCompileJobRepository.findById.mockResolvedValue(mockJob);

      // Mock the queue to return the job and waiting jobs
      const Bull = require('bull');
      const mockQueue = Bull();
      mockQueue.getJob.mockResolvedValue({ id: jobId });
      mockQueue.getWaiting.mockResolvedValue([{ id: jobId }]);

      const result = await executionService.getJobStatus(jobId);

      expect(result.status).toBe(JobStatus.QUEUED);
      expect(result.position).toBe(1);
    });

    it('should throw error for non-existent job', async () => {
      const jobId = 'non-existent-job';
      mockCompileJobRepository.findById.mockResolvedValue(null);

      await expect(
        executionService.getJobStatus(jobId)
      ).rejects.toThrow('Job not found');
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job successfully', async () => {
      const jobId = 'test-job-id';
      const userId = 'user-456';
      const mockJob = {
        id: jobId,
        roomId: 'room-123',
        userId,
        code: 'test code',
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
      };

      mockCompileJobRepository.findById.mockResolvedValue(mockJob);
      mockCompileJobRepository.cancel.mockResolvedValue({
        ...mockJob,
        status: JobStatus.CANCELLED,
        completedAt: new Date(),
      });

      const result = await executionService.cancelJob(jobId, userId);

      expect(result).toBe(true);
      expect(mockCompileJobRepository.cancel).toHaveBeenCalledWith(jobId);
    });

    it('should not cancel job for different user', async () => {
      const jobId = 'test-job-id';
      const userId = 'user-456';
      const differentUserId = 'user-789';
      const mockJob = {
        id: jobId,
        roomId: 'room-123',
        userId: differentUserId,
        code: 'test code',
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
      };

      mockCompileJobRepository.findById.mockResolvedValue(mockJob);

      const result = await executionService.cancelJob(jobId, userId);

      expect(result).toBe(false);
      expect(mockCompileJobRepository.cancel).not.toHaveBeenCalled();
    });

    it('should not cancel completed job', async () => {
      const jobId = 'test-job-id';
      const userId = 'user-456';
      const mockJob = {
        id: jobId,
        roomId: 'room-123',
        userId,
        code: 'test code',
        options: {},
        status: JobStatus.COMPLETED,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        executionTime: 1000,
        memoryUsed: null,
      };

      mockCompileJobRepository.findById.mockResolvedValue(mockJob);

      const result = await executionService.cancelJob(jobId, userId);

      expect(result).toBe(false);
      expect(mockCompileJobRepository.cancel).not.toHaveBeenCalled();
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await executionService.getQueueStats();

      expect(stats).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });
  });

  describe('handleTimeouts', () => {
    it('should mark timed out jobs', async () => {
      const timedOutJob = {
        id: 'timed-out-job',
        roomId: 'room-123',
        userId: 'user-456',
        code: 'test code',
        options: { timeout: 30000 },
        status: JobStatus.RUNNING,
        createdAt: new Date(),
        startedAt: new Date(Date.now() - 65000), // Started 65 seconds ago
        completedAt: null,
        stdout: null,
        stderr: null,
        exitCode: null,
        executionTime: null,
        memoryUsed: null,
      };

      mockCompileJobRepository.findRunningJobs.mockResolvedValue([timedOutJob]);
      mockCompileJobRepository.markTimeout.mockResolvedValue({
        ...timedOutJob,
        status: JobStatus.TIMEOUT,
        completedAt: new Date(),
      });

      await executionService.handleTimeouts();

      expect(mockCompileJobRepository.markTimeout).toHaveBeenCalledWith('timed-out-job');
    });
  });

  describe('cleanup', () => {
    it('should clean old jobs and queue data', async () => {
      mockCompileJobRepository.deleteOldJobs.mockResolvedValue(5);

      await executionService.cleanup();

      expect(mockCompileJobRepository.deleteOldJobs).toHaveBeenCalledWith(7);
    });
  });
});