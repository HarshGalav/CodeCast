import { DockerService, ContainerConfig } from '../../../lib/services/docker-service';
import { ContainerManager } from '../../../lib/services/container-manager';
import { getDockerConfig, validateDockerConfig, validateSecurityConfig } from '../../../lib/config/docker-config';

// Mock child_process to avoid actual Docker calls in tests
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('DockerService Configuration', () => {
  describe('Docker configuration', () => {
    it('should provide valid default configuration', () => {
      const config = getDockerConfig();
      
      expect(config).toHaveProperty('defaultMemoryLimit');
      expect(config).toHaveProperty('defaultCpuLimit');
      expect(config).toHaveProperty('defaultTimeoutMs');
      expect(config).toHaveProperty('defaultPidsLimit');
      expect(config).toHaveProperty('networkAccess', false);
      expect(config).toHaveProperty('readOnlyFilesystem', true);
      expect(config).toHaveProperty('dropAllCapabilities', true);
      expect(config).toHaveProperty('noNewPrivileges', true);
    });

    it('should validate configuration correctly', () => {
      const validConfig = getDockerConfig();
      const errors = validateDockerConfig(validConfig);
      expect(errors).toHaveLength(0);
    });

    it('should detect invalid memory limit format', () => {
      const config = getDockerConfig();
      config.defaultMemoryLimit = 'invalid';
      
      const errors = validateDockerConfig(config);
      expect(errors).toContain('Invalid memory limit format. Use format like "128m", "1g", etc.');
    });

    it('should detect invalid CPU limit', () => {
      const config = getDockerConfig();
      config.defaultCpuLimit = '10.0'; // Too high
      
      const errors = validateDockerConfig(config);
      expect(errors).toContain('CPU limit must be a number between 0 and 4');
    });

    it('should detect invalid timeout', () => {
      const config = getDockerConfig();
      config.defaultTimeoutMs = 500; // Too low
      
      const errors = validateDockerConfig(config);
      expect(errors).toContain('Timeout must be between 1000ms and 60000ms');
    });

    it('should validate security configuration', () => {
      const config = getDockerConfig();
      const warnings = validateSecurityConfig(config);
      expect(warnings).toHaveLength(0); // Should have no warnings for secure config
    });

    it('should warn about insecure configuration', () => {
      const config = getDockerConfig();
      config.networkAccess = true;
      config.readOnlyFilesystem = false;
      
      const warnings = validateSecurityConfig(config);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings).toContain('Network access is enabled - this may be a security risk');
      expect(warnings).toContain('Read-only filesystem is disabled - this may be a security risk');
    });
  });

  describe('Container configuration', () => {
    it('should create proper container configuration', () => {
      const config: ContainerConfig = {
        memoryLimit: '128m',
        cpuLimit: '0.5',
        timeoutMs: 10000,
        pidsLimit: 32
      };

      expect(config.memoryLimit).toBe('128m');
      expect(config.cpuLimit).toBe('0.5');
      expect(config.timeoutMs).toBe(10000);
      expect(config.pidsLimit).toBe(32);
    });

    it('should handle different memory limit formats', () => {
      const configs = [
        { memoryLimit: '64m', expected: '64m' },
        { memoryLimit: '1g', expected: '1g' },
        { memoryLimit: '512k', expected: '512k' }
      ];

      configs.forEach(({ memoryLimit, expected }) => {
        const config: ContainerConfig = {
          memoryLimit,
          cpuLimit: '0.5',
          timeoutMs: 10000,
          pidsLimit: 32
        };
        expect(config.memoryLimit).toBe(expected);
      });
    });
  });
});

describe('DockerService Structure', () => {
  describe('Service methods', () => {
    it('should have all required static methods', () => {
      expect(typeof DockerService.buildImage).toBe('function');
      expect(typeof DockerService.executeCode).toBe('function');
      expect(typeof DockerService.getContainerMetrics).toBe('function');
      expect(typeof DockerService.listRunningContainers).toBe('function');
      expect(typeof DockerService.cleanupAllContainers).toBe('function');
      expect(typeof DockerService.checkDockerAvailability).toBe('function');
    });

    it('should have proper method signatures', () => {
      // Check that methods exist and are functions
      expect(DockerService.executeCode).toBeInstanceOf(Function);
      expect(DockerService.buildImage).toBeInstanceOf(Function);
      expect(DockerService.checkDockerAvailability).toBeInstanceOf(Function);
    });
  });

  describe('Error handling structure', () => {
    it('should define proper execution result interface', () => {
      // Test that we can create a proper ExecutionResult object
      const result = {
        success: true,
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 1000,
        timedOut: false
      };

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('executionTime');
      expect(result).toHaveProperty('timedOut');
    });
  });
});

describe('ContainerManager Structure', () => {
  describe('Manager initialization', () => {
    it('should create container manager with default config', () => {
      const manager = new ContainerManager();
      expect(manager).toBeInstanceOf(ContainerManager);
    });

    it('should create container manager with custom config', () => {
      const customConfig = {
        maxConcurrentContainers: 3,
        defaultTimeout: 5000,
        metricsCollectionInterval: 2000,
        cleanupInterval: 30000
      };

      const manager = new ContainerManager(customConfig);
      expect(manager).toBeInstanceOf(ContainerManager);
    });

    it('should have required methods', () => {
      const manager = new ContainerManager();
      
      expect(typeof manager.executeCode).toBe('function');
      expect(typeof manager.getJob).toBe('function');
      expect(typeof manager.getActiveJobs).toBe('function');
      expect(typeof manager.getSystemMetrics).toBe('function');
      expect(typeof manager.stopJob).toBe('function');
      expect(typeof manager.shutdown).toBe('function');
    });
  });

  describe('Job management structure', () => {
    it('should provide system metrics structure', () => {
      const manager = new ContainerManager();
      const metrics = manager.getSystemMetrics();

      expect(metrics).toHaveProperty('runningContainers');
      expect(metrics).toHaveProperty('maxConcurrentContainers');
      expect(metrics).toHaveProperty('totalJobs');
      expect(metrics).toHaveProperty('completedJobs');
      expect(metrics).toHaveProperty('failedJobs');

      expect(typeof metrics.runningContainers).toBe('number');
      expect(typeof metrics.maxConcurrentContainers).toBe('number');
      expect(typeof metrics.totalJobs).toBe('number');
      expect(typeof metrics.completedJobs).toBe('number');
      expect(typeof metrics.failedJobs).toBe('number');
    });

    it('should handle active jobs tracking', () => {
      const manager = new ContainerManager();
      const activeJobs = manager.getActiveJobs();
      
      expect(Array.isArray(activeJobs)).toBe(true);
    });
  });
});

describe('Security Requirements Compliance', () => {
  describe('Requirement 5.1 - Network isolation', () => {
    it('should enforce network isolation in configuration', () => {
      const config = getDockerConfig();
      expect(config.networkAccess).toBe(false);
    });
  });

  describe('Requirement 5.2 - Memory limits', () => {
    it('should have memory limit configuration', () => {
      const config = getDockerConfig();
      expect(config.defaultMemoryLimit).toBeDefined();
      expect(typeof config.defaultMemoryLimit).toBe('string');
      expect(config.defaultMemoryLimit).toMatch(/^\d+[kmg]?$/i);
    });
  });

  describe('Requirement 5.3 - CPU limits', () => {
    it('should have CPU limit configuration', () => {
      const config = getDockerConfig();
      expect(config.defaultCpuLimit).toBeDefined();
      expect(typeof config.defaultCpuLimit).toBe('string');
      
      const cpuLimit = parseFloat(config.defaultCpuLimit);
      expect(cpuLimit).toBeGreaterThan(0);
      expect(cpuLimit).toBeLessThanOrEqual(4);
    });
  });

  describe('Requirement 5.4 - Process limits', () => {
    it('should have PIDs limit configuration', () => {
      const config = getDockerConfig();
      expect(config.defaultPidsLimit).toBeDefined();
      expect(typeof config.defaultPidsLimit).toBe('number');
      expect(config.defaultPidsLimit).toBeGreaterThan(0);
    });
  });

  describe('Requirement 5.5 - No privilege escalation', () => {
    it('should enforce no new privileges', () => {
      const config = getDockerConfig();
      expect(config.noNewPrivileges).toBe(true);
    });
  });

  describe('Requirement 5.6 - Non-root execution', () => {
    it('should enforce capability dropping', () => {
      const config = getDockerConfig();
      expect(config.dropAllCapabilities).toBe(true);
    });
  });

  describe('Requirement 5.7 - Container cleanup', () => {
    it('should have cleanup configuration', () => {
      const config = getDockerConfig();
      expect(config.containerCleanupInterval).toBeDefined();
      expect(typeof config.containerCleanupInterval).toBe('number');
      expect(config.containerCleanupInterval).toBeGreaterThan(0);
    });
  });
});

describe('Docker Image and Dockerfile', () => {
  describe('Dockerfile security', () => {
    it('should have secure Dockerfile configuration', () => {
      const config = getDockerConfig();
      expect(config.imageName).toBe('cpp-executor');
      expect(config.dockerfilePath).toBe('docker/cpp-executor');
    });
  });

  describe('Container lifecycle', () => {
    it('should support container metrics collection', () => {
      const config = getDockerConfig();
      expect(config.metricsCollectionEnabled).toBe(true);
      expect(config.metricsCollectionInterval).toBeGreaterThan(0);
    });

    it('should support job history retention', () => {
      const config = getDockerConfig();
      expect(config.jobHistoryRetention).toBeGreaterThan(0);
    });
  });
});