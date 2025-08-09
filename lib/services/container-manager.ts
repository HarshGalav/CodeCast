import { DockerService, ContainerConfig, ExecutionResult, ContainerMetrics } from './docker-service';
import { EventEmitter } from 'events';

export interface ContainerJob {
  id: string;
  code: string;
  config: ContainerConfig;
  startTime: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
  result?: ExecutionResult;
  metrics?: ContainerMetrics[];
}

export interface ContainerManagerConfig {
  maxConcurrentContainers: number;
  defaultTimeout: number;
  metricsCollectionInterval: number;
  cleanupInterval: number;
}

export class ContainerManager extends EventEmitter {
  private jobs = new Map<string, ContainerJob>();
  private runningContainers = new Set<string>();
  private config: ContainerManagerConfig;
  private metricsInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<ContainerManagerConfig> = {}) {
    super();
    
    this.config = {
      maxConcurrentContainers: 5,
      defaultTimeout: 10000,
      metricsCollectionInterval: 1000,
      cleanupInterval: 60000,
      ...config
    };

    this.startBackgroundTasks();
  }

  /**
   * Execute code in a container with monitoring
   */
  async executeCode(
    jobId: string,
    code: string,
    config: Partial<ContainerConfig> = {}
  ): Promise<ExecutionResult> {
    // Check if we've reached the concurrent container limit
    if (this.runningContainers.size >= this.config.maxConcurrentContainers) {
      throw new Error('Maximum concurrent containers reached. Please try again later.');
    }

    const finalConfig: ContainerConfig = {
      memoryLimit: '128m',
      cpuLimit: '0.5',
      timeoutMs: this.config.defaultTimeout,
      pidsLimit: 32,
      ...config
    };

    const job: ContainerJob = {
      id: jobId,
      code,
      config: finalConfig,
      startTime: Date.now(),
      status: 'queued',
      metrics: []
    };

    this.jobs.set(jobId, job);
    this.emit('jobQueued', job);

    try {
      // Mark as running
      job.status = 'running';
      this.runningContainers.add(jobId);
      this.emit('jobStarted', job);

      // Start metrics collection for this job
      const metricsCollector = this.startMetricsCollection(jobId);

      // Execute the code
      const result = await DockerService.executeCode(code, finalConfig);

      // Stop metrics collection
      if (metricsCollector) {
        clearInterval(metricsCollector);
      }

      // Update job status
      job.result = result;
      job.status = result.success ? 'completed' : (result.timedOut ? 'timeout' : 'failed');
      
      this.emit('jobCompleted', job);
      
      return result;
    } catch (error) {
      job.status = 'failed';
      job.result = {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: -1,
        executionTime: Date.now() - job.startTime,
        timedOut: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.emit('jobFailed', job);
      
      return job.result;
    } finally {
      // Always cleanup
      this.runningContainers.delete(jobId);
      
      // Keep job history for a while, then remove
      setTimeout(() => {
        this.jobs.delete(jobId);
      }, 300000); // 5 minutes
    }
  }

  /**
   * Get job status and metrics
   */
  getJob(jobId: string): ContainerJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): ContainerJob[] {
    return Array.from(this.jobs.values()).filter(job => 
      job.status === 'running' || job.status === 'queued'
    );
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): {
    runningContainers: number;
    maxConcurrentContainers: number;
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
  } {
    const jobs = Array.from(this.jobs.values());
    
    return {
      runningContainers: this.runningContainers.size,
      maxConcurrentContainers: this.config.maxConcurrentContainers,
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed' || j.status === 'timeout').length
    };
  }

  /**
   * Force stop a job
   */
  async stopJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    try {
      // The DockerService will handle container cleanup
      job.status = 'failed';
      job.result = {
        success: false,
        stdout: '',
        stderr: 'Job was manually stopped',
        exitCode: -1,
        executionTime: Date.now() - job.startTime,
        timedOut: false,
        error: 'Job was manually stopped'
      };

      this.runningContainers.delete(jobId);
      this.emit('jobStopped', job);
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start collecting metrics for a job
   */
  private startMetricsCollection(jobId: string): NodeJS.Timeout | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return setInterval(async () => {
      if (job.status !== 'running') return;

      try {
        const metrics = await DockerService.getContainerMetrics(`cpp-exec-${jobId.substring(0, 8)}`);
        if (metrics) {
          job.metrics = job.metrics || [];
          job.metrics.push(metrics);
          
          // Keep only last 60 metrics (1 minute if collected every second)
          if (job.metrics.length > 60) {
            job.metrics = job.metrics.slice(-60);
          }

          this.emit('metricsCollected', { jobId, metrics });
        }
      } catch {
        // Ignore metrics collection errors
      }
    }, this.config.metricsCollectionInterval);
  }

  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Periodic cleanup of old jobs and containers
    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup();
    }, this.config.cleanupInterval);

    // Cleanup on process exit
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Perform cleanup of old jobs and orphaned containers
   */
  private async performCleanup(): Promise<void> {
    try {
      // Remove old completed jobs (older than 1 hour)
      const oneHourAgo = Date.now() - 3600000;
      for (const [jobId, job] of this.jobs.entries()) {
        if (job.startTime < oneHourAgo && job.status !== 'running') {
          this.jobs.delete(jobId);
        }
      }

      // Cleanup any orphaned containers
      await DockerService.cleanupAllContainers();
      
      this.emit('cleanupCompleted');
    } catch (error) {
      this.emit('cleanupError', error);
    }
  }

  /**
   * Shutdown the container manager
   */
  async shutdown(): Promise<void> {
    // Clear intervals
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Stop all running jobs
    const activeJobs = this.getActiveJobs();
    await Promise.all(activeJobs.map(job => this.stopJob(job.id)));

    // Final cleanup
    await DockerService.cleanupAllContainers();
    
    this.emit('shutdown');
  }

  /**
   * Initialize the container manager (build Docker image if needed)
   */
  static async initialize(): Promise<ContainerManager> {
    const { available, imageExists } = await DockerService.checkDockerAvailability();
    
    if (!available) {
      throw new Error('Docker is not available. Please ensure Docker is installed and running.');
    }

    if (!imageExists) {
      console.log('Building Docker image for C++ execution...');
      await DockerService.buildImage();
      console.log('Docker image built successfully.');
    }

    return new ContainerManager();
  }
}