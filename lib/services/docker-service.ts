import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ContainerConfig {
  memoryLimit: string; // e.g., "128m"
  cpuLimit: string; // e.g., "0.5"
  timeoutMs: number; // execution timeout in milliseconds
  pidsLimit: number; // max number of processes
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  memoryUsed?: number;
  timedOut: boolean;
  error?: string;
}

export interface ContainerMetrics {
  memoryUsage: number;
  cpuUsage: number;
  pidsCount: number;
}

export class DockerService {
  private static readonly IMAGE_NAME = 'cpp-executor';
  private static readonly CONTAINER_PREFIX = 'cpp-exec-';
  private static readonly DEFAULT_CONFIG: ContainerConfig = {
    memoryLimit: '128m',
    cpuLimit: '0.5',
    timeoutMs: 10000, // 10 seconds
    pidsLimit: 32
  };

  /**
   * Build the Docker image if it doesn't exist
   */
  static async buildImage(): Promise<void> {
    const dockerfilePath = path.join(process.cwd(), 'docker', 'cpp-executor');
    
    return new Promise((resolve, reject) => {
      const buildProcess = spawn('docker', [
        'build',
        '-t', DockerService.IMAGE_NAME,
        dockerfilePath
      ]);

      let stderr = '';
      buildProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker build failed: ${stderr}`));
        }
      });

      buildProcess.on('error', (error) => {
        reject(new Error(`Failed to start docker build: ${error.message}`));
      });
    });
  }

  /**
   * Execute C++ code in a secure container
   */
  static async executeCode(
    code: string, 
    config: Partial<ContainerConfig> = {}
  ): Promise<ExecutionResult> {
    const finalConfig = { ...DockerService.DEFAULT_CONFIG, ...config };
    const containerId = DockerService.generateContainerId();
    const startTime = Date.now();

    try {
      // Create temporary file for the code
      const tempFile = await DockerService.createTempFile(code);
      
      // Create and run container
      const result = await DockerService.runContainer(containerId, tempFile, finalConfig);
      
      // Cleanup
      await DockerService.cleanup(containerId, tempFile);
      
      return {
        ...result,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      // Ensure cleanup even on error
      await DockerService.cleanup(containerId);
      
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTime: Date.now() - startTime,
        timedOut: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create a secure container with strict policies
   */
  private static async runContainer(
    containerId: string,
    codePath: string,
    config: ContainerConfig
  ): Promise<Omit<ExecutionResult, 'executionTime'>> {
    return new Promise((resolve) => {
      const dockerArgs = [
        'run',
        '--name', containerId,
        '--rm', // Auto-remove container when it exits
        '--net=none', // No network access
        '--memory', config.memoryLimit,
        '--cpus', config.cpuLimit,
        '--pids-limit', config.pidsLimit.toString(),
        '--no-new-privileges', // Prevent privilege escalation
        '--read-only', // Read-only filesystem
        '--tmpfs', '/tmp:noexec,nosuid,size=10m', // Temporary filesystem for compilation
        '--security-opt', 'no-new-privileges:true',
        '--cap-drop', 'ALL', // Drop all capabilities
        '--user', '1000:1000', // Run as non-root user
        '-v', `${codePath}:/app/workspace/main.cpp:ro`, // Mount code file as read-only
        DockerService.IMAGE_NAME,
        '/bin/sh', '-c',
        // Compile and execute with resource monitoring
        'cd /tmp && cp /app/workspace/main.cpp . && g++ -o main main.cpp -std=c++17 -Wall -Wextra && timeout 5s ./main'
      ];

      const containerProcess = spawn('docker', dockerArgs);
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        DockerService.forceKillContainer(containerId);
      }, config.timeoutMs);

      containerProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      containerProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      containerProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        
        resolve({
          success: code === 0 && !timedOut,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || -1,
          timedOut
        });
      });

      containerProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        
        resolve({
          success: false,
          stdout: '',
          stderr: `Container execution error: ${error.message}`,
          exitCode: -1,
          timedOut: false
        });
      });
    });
  }

  /**
   * Force kill a container
   */
  private static async forceKillContainer(containerId: string): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        const killProcess = spawn('docker', ['kill', containerId]);
        killProcess.on('close', () => resolve());
        killProcess.on('error', () => resolve()); // Ignore errors
      });
    } catch {
      // Ignore errors - container might already be stopped
    }
  }

  /**
   * Get container resource usage metrics
   */
  static async getContainerMetrics(containerId: string): Promise<ContainerMetrics | null> {
    return new Promise((resolve) => {
      const statsProcess = spawn('docker', ['stats', containerId, '--no-stream', '--format', 'json']);
      let output = '';

      statsProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      statsProcess.on('close', (code) => {
        if (code === 0 && output.trim()) {
          try {
            const stats = JSON.parse(output.trim());
            resolve({
              memoryUsage: DockerService.parseMemoryUsage(stats.MemUsage),
              cpuUsage: parseFloat(stats.CPUPerc.replace('%', '')),
              pidsCount: parseInt(stats.PIDs) || 0
            });
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      statsProcess.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Parse memory usage from Docker stats format (e.g., "45.2MiB / 128MiB")
   */
  private static parseMemoryUsage(memUsage: string): number {
    const match = memUsage.match(/^([\d.]+)(\w+)/);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'b': return value;
      case 'kib': return value * 1024;
      case 'mib': return value * 1024 * 1024;
      case 'gib': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  /**
   * Create temporary file for code
   */
  private static async createTempFile(code: string): Promise<string> {
    const tempDir = path.join(process.cwd(), 'tmp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const fileName = `code-${randomUUID()}.cpp`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.writeFile(filePath, code, 'utf8');
    return filePath;
  }

  /**
   * Generate unique container ID
   */
  private static generateContainerId(): string {
    return `${DockerService.CONTAINER_PREFIX}${randomUUID().substring(0, 8)}`;
  }

  /**
   * Cleanup container and temporary files
   */
  private static async cleanup(containerId?: string, tempFile?: string): Promise<void> {
    const cleanupPromises: Promise<void>[] = [];

    // Remove container if it exists
    if (containerId) {
      cleanupPromises.push(
        new Promise<void>((resolve) => {
          const rmProcess = spawn('docker', ['rm', '-f', containerId]);
          rmProcess.on('close', () => resolve());
          rmProcess.on('error', () => resolve()); // Ignore errors
        })
      );
    }

    // Remove temporary file
    if (tempFile) {
      cleanupPromises.push(
        fs.unlink(tempFile).catch(() => {}) // Ignore errors
      );
    }

    await Promise.all(cleanupPromises);
  }

  /**
   * List all running containers with our prefix
   */
  static async listRunningContainers(): Promise<string[]> {
    return new Promise((resolve) => {
      const listProcess = spawn('docker', [
        'ps',
        '--filter', `name=${DockerService.CONTAINER_PREFIX}`,
        '--format', '{{.Names}}'
      ]);

      let output = '';
      listProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      listProcess.on('close', () => {
        const containers = output.trim().split('\n').filter(name => name.length > 0);
        resolve(containers);
      });

      listProcess.on('error', () => {
        resolve([]);
      });
    });
  }

  /**
   * Cleanup all containers with our prefix (emergency cleanup)
   */
  static async cleanupAllContainers(): Promise<void> {
    const containers = await DockerService.listRunningContainers();
    
    if (containers.length === 0) return;

    const cleanupPromises = containers.map(containerId =>
      DockerService.cleanup(containerId)
    );

    await Promise.all(cleanupPromises);
  }

  /**
   * Check if Docker is available and image exists
   */
  static async checkDockerAvailability(): Promise<{ available: boolean; imageExists: boolean }> {
    try {
      // Check if Docker is running
      const dockerCheck = await new Promise<boolean>((resolve) => {
        const process = spawn('docker', ['version']);
        process.on('close', (code) => resolve(code === 0));
        process.on('error', () => resolve(false));
      });

      if (!dockerCheck) {
        return { available: false, imageExists: false };
      }

      // Check if our image exists
      const imageCheck = await new Promise<boolean>((resolve) => {
        const process = spawn('docker', ['images', '-q', DockerService.IMAGE_NAME]);
        let output = '';
        process.stdout.on('data', (data) => output += data.toString());
        process.on('close', () => resolve(output.trim().length > 0));
        process.on('error', () => resolve(false));
      });

      return { available: true, imageExists: imageCheck };
    } catch {
      return { available: false, imageExists: false };
    }
  }
}