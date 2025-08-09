import { prisma, handleDatabaseError } from '@/lib/db'
import type { 
  CompileJob, 
  CompileJobWithRoom, 
  CreateCompileJobInput, 
  UpdateCompileJobInput,
  JobStatus 
} from '@/lib/types/database'

export class CompileJobRepository {
  /**
   * Create a new compile job
   */
  static async create(data: CreateCompileJobInput): Promise<CompileJob> {
    try {
      return await prisma.compileJob.create({
        data,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find a compile job by ID
   */
  static async findById(id: string): Promise<CompileJob | null> {
    try {
      return await prisma.compileJob.findUnique({
        where: { id },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find compile jobs by room ID
   */
  static async findByRoom(
    roomId: string, 
    limit: number = 10
  ): Promise<CompileJob[]> {
    try {
      return await prisma.compileJob.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find compile jobs by user
   */
  static async findByUser(
    userId: string, 
    limit: number = 10
  ): Promise<CompileJobWithRoom[]> {
    try {
      return await prisma.compileJob.findMany({
        where: { userId },
        include: { room: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find queued jobs for processing
   */
  static async findQueuedJobs(limit: number = 5): Promise<CompileJob[]> {
    try {
      return await prisma.compileJob.findMany({
        where: { status: JobStatus.QUEUED },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find running jobs (for timeout checking)
   */
  static async findRunningJobs(): Promise<CompileJob[]> {
    try {
      return await prisma.compileJob.findMany({
        where: { status: JobStatus.RUNNING },
        orderBy: { startedAt: 'asc' },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update a compile job
   */
  static async update(
    id: string, 
    data: UpdateCompileJobInput
  ): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark job as started
   */
  static async markStarted(id: string): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data: {
          status: JobStatus.RUNNING,
          startedAt: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark job as completed with results
   */
  static async markCompleted(
    id: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    executionTime: number,
    memoryUsed?: number
  ): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          stdout,
          stderr,
          exitCode,
          executionTime,
          memoryUsed,
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark job as failed
   */
  static async markFailed(
    id: string,
    stderr: string,
    exitCode?: number
  ): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data: {
          status: JobStatus.FAILED,
          completedAt: new Date(),
          stderr,
          exitCode,
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark job as timed out
   */
  static async markTimeout(id: string): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data: {
          status: JobStatus.TIMEOUT,
          completedAt: new Date(),
          stderr: 'Execution timed out',
          exitCode: 124, // Standard timeout exit code
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Cancel a job
   */
  static async cancel(id: string): Promise<CompileJob> {
    try {
      return await prisma.compileJob.update({
        where: { id },
        data: {
          status: JobStatus.CANCELLED,
          completedAt: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Delete old completed jobs
   */
  static async deleteOldJobs(daysOld: number = 7): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)
      
      const result = await prisma.compileJob.deleteMany({
        where: {
          completedAt: { lt: cutoffDate },
          status: { in: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.TIMEOUT] },
        },
      })

      return result.count
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Get job statistics for a room
   */
  static async getRoomStats(roomId: string): Promise<{
    total: number
    completed: number
    failed: number
    queued: number
    running: number
  }> {
    try {
      const [total, completed, failed, queued, running] = await Promise.all([
        prisma.compileJob.count({ where: { roomId } }),
        prisma.compileJob.count({ where: { roomId, status: JobStatus.COMPLETED } }),
        prisma.compileJob.count({ where: { roomId, status: JobStatus.FAILED } }),
        prisma.compileJob.count({ where: { roomId, status: JobStatus.QUEUED } }),
        prisma.compileJob.count({ where: { roomId, status: JobStatus.RUNNING } }),
      ])

      return { total, completed, failed, queued, running }
    } catch (error) {
      handleDatabaseError(error)
    }
  }
}