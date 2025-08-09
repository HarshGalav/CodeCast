export interface DockerExecutionConfig {
  // Container resource limits
  defaultMemoryLimit: string;
  defaultCpuLimit: string;
  defaultTimeoutMs: number;
  defaultPidsLimit: number;
  
  // Security settings
  networkAccess: boolean;
  readOnlyFilesystem: boolean;
  dropAllCapabilities: boolean;
  noNewPrivileges: boolean;
  
  // Container management
  maxConcurrentContainers: number;
  containerCleanupInterval: number;
  jobHistoryRetention: number;
  
  // Monitoring
  metricsCollectionEnabled: boolean;
  metricsCollectionInterval: number;
  
  // Image settings
  imageName: string;
  imageTag: string;
  dockerfilePath: string;
}

export const DEFAULT_DOCKER_CONFIG: DockerExecutionConfig = {
  // Resource limits - conservative defaults for security
  defaultMemoryLimit: '128m',
  defaultCpuLimit: '0.5',
  defaultTimeoutMs: 10000, // 10 seconds
  defaultPidsLimit: 32,
  
  // Security settings - all hardened
  networkAccess: false,
  readOnlyFilesystem: true,
  dropAllCapabilities: true,
  noNewPrivileges: true,
  
  // Container management
  maxConcurrentContainers: 5,
  containerCleanupInterval: 60000, // 1 minute
  jobHistoryRetention: 3600000, // 1 hour
  
  // Monitoring
  metricsCollectionEnabled: true,
  metricsCollectionInterval: 1000, // 1 second
  
  // Image settings
  imageName: 'cpp-executor',
  imageTag: 'latest',
  dockerfilePath: 'docker/cpp-executor'
};

export const PRODUCTION_DOCKER_CONFIG: Partial<DockerExecutionConfig> = {
  // More restrictive limits for production
  defaultMemoryLimit: '64m',
  defaultCpuLimit: '0.25',
  defaultTimeoutMs: 5000, // 5 seconds
  defaultPidsLimit: 16,
  maxConcurrentContainers: 10,
};

export const DEVELOPMENT_DOCKER_CONFIG: Partial<DockerExecutionConfig> = {
  // More lenient limits for development
  defaultMemoryLimit: '256m',
  defaultCpuLimit: '1.0',
  defaultTimeoutMs: 30000, // 30 seconds
  defaultPidsLimit: 64,
  maxConcurrentContainers: 3,
};

/**
 * Get Docker configuration based on environment
 */
export function getDockerConfig(): DockerExecutionConfig {
  const baseConfig = { ...DEFAULT_DOCKER_CONFIG };
  
  if (process.env.NODE_ENV === 'production') {
    return { ...baseConfig, ...PRODUCTION_DOCKER_CONFIG };
  } else if (process.env.NODE_ENV === 'development') {
    return { ...baseConfig, ...DEVELOPMENT_DOCKER_CONFIG };
  }
  
  return baseConfig;
}

/**
 * Validate Docker configuration
 */
export function validateDockerConfig(config: DockerExecutionConfig): string[] {
  const errors: string[] = [];
  
  // Validate memory limit format
  if (!/^\d+[kmg]?$/i.test(config.defaultMemoryLimit)) {
    errors.push('Invalid memory limit format. Use format like "128m", "1g", etc.');
  }
  
  // Validate CPU limit
  const cpuLimit = parseFloat(config.defaultCpuLimit);
  if (isNaN(cpuLimit) || cpuLimit <= 0 || cpuLimit > 4) {
    errors.push('CPU limit must be a number between 0 and 4');
  }
  
  // Validate timeout
  if (config.defaultTimeoutMs < 1000 || config.defaultTimeoutMs > 60000) {
    errors.push('Timeout must be between 1000ms and 60000ms');
  }
  
  // Validate pids limit
  if (config.defaultPidsLimit < 1 || config.defaultPidsLimit > 1024) {
    errors.push('PIDs limit must be between 1 and 1024');
  }
  
  // Validate concurrent containers
  if (config.maxConcurrentContainers < 1 || config.maxConcurrentContainers > 50) {
    errors.push('Max concurrent containers must be between 1 and 50');
  }
  
  return errors;
}

/**
 * Security validation - ensure all security features are enabled
 */
export function validateSecurityConfig(config: DockerExecutionConfig): string[] {
  const warnings: string[] = [];
  
  if (config.networkAccess) {
    warnings.push('Network access is enabled - this may be a security risk');
  }
  
  if (!config.readOnlyFilesystem) {
    warnings.push('Read-only filesystem is disabled - this may be a security risk');
  }
  
  if (!config.dropAllCapabilities) {
    warnings.push('Not dropping all capabilities - this may be a security risk');
  }
  
  if (!config.noNewPrivileges) {
    warnings.push('New privileges are allowed - this may be a security risk');
  }
  
  return warnings;
}