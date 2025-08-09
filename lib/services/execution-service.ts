import Bull, { Queue, Job, JobOptions } from 'bull';
import { randomUUID } from 'crypto';
import { redisConfig } from '@/lib/config/redis-config';
import { DockerService, ExecutionResult, ContainerConfig } from '@/lib/services/docker-service';
import { CompileJobRepository } from '@/lib/repositories/compile-job-repository';
import { JobStatus, CompileOptions } from '@/lib/types/database';
import { config } from '@/lib/config';

export interface CompileJobData {
  jobId: string;
  roomId: string;
  userId: string;
  code: string;
  options: CompileOptions;
}

export interface JobPriority {
  HIGH: number;
  NORMAL: number;
  LOW: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export class ExecutionService {
  private static instance: ExecutionService;
  private compileQueue: Queue<CompileJobData>;
  private readonly QUEUE_NAME = 'compile-jobs';
  
  // Job priorities
  private static readonly PRIORITY: JobPriority = {
    HIGH: 10,
    NORMAL: 5,
    LOW: 1,
  };

  // Rate limiting configuration
  private static readonly RATE_LIMIT = {
    MAX_JOBS_PER_USER_PER_MINUTE: 5,
    MAX_CONCURRENT_JOBS: 3,
    MAX_QUEUE_SIZE: 100,
  };

  private constructor() {
    this.compileQueue = new Bull(this.QUEUE_NAME, redisConfig);
    this.setupQueueProcessing();
    this.setupQueueEvents();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ExecutionService {
    if (!ExecutionService.instance) {
      ExecutionService.instance = new ExecutionService();
    }
    return ExecutionService.instance;
  }

  /**
   * Queue a compilation job
   */
  async queueJob(
    roomId: string,
    userId: string,
    code: string,
    options: Partial<CompileOptions> = {}
  ): Promise<string> {
    // Check rate limits
    await this.checkRateLimits(userId);

    // Generate job ID
    const jobId = randomUUID();

    // Create job in database
    const compileOptions: CompileOptions = {
      flags: options.flags || ['-std=c++17', '-Wall', '-Wextra'],
      timeout: options.timeout || config.compilation.maxExecutionTime,
      memoryLimit: options.memoryLimit || config.compilation.maxMemoryLimit,
      cpuLimit: options.cpuLimit || config.compilation.maxCpuLimit,
    };

    await CompileJobRepository.create({
      id: jobId,
      roomId,
      userId,
      code,
      options: compileOptions,
      status: JobStatus.QUEUED,
    });

    // Queue job with priority and options
    const jobOptions: JobOptions = {
      priority: this.calculateJobPriority(userId),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 10, // Keep last 10 completed jobs
      removeOnFail: 10, // Keep last 10 failed jobs
      timeout: compileOptions.timeout + 5000, // Add buffer for queue processing
    };

    const jobData: CompileJobData = {
      jobId,
      roomId,
      userId,
      code,
      options: compileOptions,
    };

    await this.compileQueue.add(jobData, jobOptions);

    return jobId;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    status: JobStatus;
    result?: ExecutionResult;
    position?: number;
  }> {
    // Get from database first
    const dbJob = await CompileJobRepository.findById(jobId);
    if (!dbJob) {
      throw new Error('Job not found');
    }

    // If job is completed, return database result
    if ([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TIMEOUT, JobStatus.CANCELLED].includes(dbJob.status as JobStatus)) {
      const result: ExecutionResult = {
        success: dbJob.status === JobStatus.COMPLETED,
        stdout: dbJob.stdout || '',
        stderr: dbJob.stderr || '',
        exitCode: dbJob.exitCode ?? -1,
        executionTime: dbJob.executionTime || 0,
        memoryUsed: dbJob.memoryUsed || undefined,
        timedOut: dbJob.status === JobStatus.TIMEOUT,
      };

      return {
        status: dbJob.status as JobStatus,
        result,
      };
    }

    // For queued/running jobs, check queue position
    const queueJob = await this.compileQueue.getJob(jobId);
    let position: number | undefined;

    if (queueJob && dbJob.status === JobStatus.QUEUED) {
      const waitingJobs = await this.compileQueue.getWaiting();
      position = waitingJobs.findIndex(job => job.id === jobId) + 1;
    }

    return {
      status: dbJob.status as JobStatus,
      position,
    };
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, userId: string): Promise<boolean> {
    const dbJob = await CompileJobRepository.findById(jobId);
    if (!dbJob || dbJob.userId !== userId) {
      return false;
    }

    // Can only cancel queued or running jobs
    if (![JobStatus.QUEUED, JobStatus.RUNNING].includes(dbJob.status as JobStatus)) {
      return false;
    }

    // Remove from queue if queued
    if (dbJob.status === JobStatus.QUEUED) {
      const queueJob = await this.compileQueue.getJob(jobId);
      if (queueJob) {
        await queueJob.remove();
      }
    }

    // Update database
    await CompileJobRepository.cancel(jobId);
    return true;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.compileQueue.getWaiting(),
      this.compileQueue.getActive(),
      this.compileQueue.getCompleted(),
      this.compileQueue.getFailed(),
      this.compileQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Setup queue processing
   */
  private setupQueueProcessing(): void {
    this.compileQueue.process(
      ExecutionService.RATE_LIMIT.MAX_CONCURRENT_JOBS,
      this.processCompileJob.bind(this)
    );
  }

  /**
   * Process a compile job
   */
  private async processCompileJob(job: Job<CompileJobData>): Promise<ExecutionResult> {
    const { jobId, code, options } = job.data;

    try {
      // Mark job as started
      await CompileJobRepository.markStarted(jobId);

      // Convert compile options to container config
      const containerConfig: ContainerConfig = {
        memoryLimit: options.memoryLimit,
        cpuLimit: options.cpuLimit,
        timeoutMs: options.timeout,
        pidsLimit: 32,
      };

      // Execute code in Docker container
      const result = await DockerService.executeCode(code, containerConfig);

      // Update job in database based on result
      if (result.timedOut) {
        await CompileJobRepository.markTimeout(jobId);
      } else if (result.success) {
        await CompileJobRepository.markCompleted(
          jobId,
          result.stdout,
          result.stderr,
          result.exitCode,
          result.executionTime,
          result.memoryUsed
        );
      } else {
        await CompileJobRepository.markFailed(
          jobId,
          result.stderr || result.error || 'Unknown error',
          result.exitCode
        );
      }

      return result;
    } catch (error) {
      // Mark job as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await CompileJobRepository.markFailed(jobId, errorMessage);

      throw error;
    }
  }

  /**
   * Setup queue event handlers
   */
  private setupQueueEvents(): void {
    this.compileQueue.on('completed', (job: Job<CompileJobData>, result: ExecutionResult) => {
      console.log(`Job ${job.data.jobId} completed successfully`);
    });

    this.compileQueue.on('failed', (job: Job<CompileJobData>, error: Error) => {
      console.error(`Job ${job.data.jobId} failed:`, error.message);
    });

    this.compileQueue.on('stalled', (job: Job<CompileJobData>) => {
      console.warn(`Job ${job.data.jobId} stalled`);
    });

    this.compileQueue.on('error', (error: Error) => {
      console.error('Queue error:', error);
    });
  }

  /**
   * Check rate limits for user
   */
  private async checkRateLimits(userId: string): Promise<void> {
    // Check queue size
    const stats = await this.getQueueStats();
    if (stats.waiting + stats.active >= ExecutionService.RATE_LIMIT.MAX_QUEUE_SIZE) {
      throw new Error('Queue is full. Please try again later.');
    }

    // Check user rate limit (jobs per minute)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentJobs = await CompileJobRepository.findByUser(userId, 50);
    const recentJobsCount = recentJobs.filter(job => 
      job.createdAt > oneMinuteAgo
    ).length;

    if (recentJobsCount >= ExecutionService.RATE_LIMIT.MAX_JOBS_PER_USER_PER_MINUTE) {
      throw new Error('Rate limit exceeded. Please wait before submitting another job.');
    }
  }

  /**
   * Calculate job priority based on user activity
   */
  private calculateJobPriority(userId: string): number {
    // For now, return normal priority
    // Could be enhanced to give higher priority to premium users, etc.
    return ExecutionService.PRIORITY.NORMAL;
  }

  /**
   * Cleanup old jobs and queue data
   */
  async cleanup(): Promise<void> {
    // Clean completed and failed jobs older than 1 hour
    await this.compileQueue.clean(60 * 60 * 1000, 'completed');
    await this.compileQueue.clean(60 * 60 * 1000, 'failed');
    
    // Clean database jobs older than 7 days
    await CompileJobRepository.deleteOldJobs(7);
  }

  /**
   * Handle timeout for running jobs
   */
  async handleTimeouts(): Promise<void> {
    const runningJobs = await CompileJobRepository.findRunningJobs();
    const now = Date.now();

    for (const job of runningJobs) {
      if (!job.startedAt) continue;

      const runningTime = now - job.startedAt.getTime();
      const maxTime = (job.options as CompileOptions).timeout + 30000; // Add 30s buffer

      if (runningTime > maxTime) {
        console.warn(`Job ${job.id} timed out, marking as timeout`);
        await CompileJobRepository.markTimeout(job.id);
        
        // Try to remove from queue if still there
        const queueJob = await this.compileQueue.getJob(job.id);
        if (queueJob) {
          await queueJob.remove();
        }
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    await this.compileQueue.close();
  }
}