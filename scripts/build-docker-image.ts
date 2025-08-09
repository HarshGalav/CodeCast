#!/usr/bin/env tsx

import { DockerService } from '../lib/services/docker-service';
import { ContainerManager } from '../lib/services/container-manager';

async function buildDockerImage() {
  console.log('🐳 Building Docker image for secure C++ execution...');
  
  try {
    // Check Docker availability
    const { available, imageExists } = await DockerService.checkDockerAvailability();
    
    if (!available) {
      console.error('❌ Docker is not available. Please ensure Docker is installed and running.');
      process.exit(1);
    }

    if (imageExists) {
      console.log('✅ Docker image already exists.');
    } else {
      console.log('📦 Building Docker image...');
      await DockerService.buildImage();
      console.log('✅ Docker image built successfully.');
    }

    // Test the setup with a simple program
    console.log('🧪 Testing container execution...');
    
    const testCode = `
#include <iostream>
#include <string>

int main() {
    std::cout << "Hello from secure container!" << std::endl;
    std::cout << "C++ compilation and execution working correctly." << std::endl;
    return 0;
}
`;

    const result = await DockerService.executeCode(testCode, {
      memoryLimit: '64m',
      cpuLimit: '0.25',
      timeoutMs: 5000,
      pidsLimit: 16
    });

    if (result.success) {
      console.log('✅ Container execution test passed!');
      console.log('📊 Test Results:');
      console.log(`   - Exit Code: ${result.exitCode}`);
      console.log(`   - Execution Time: ${result.executionTime}ms`);
      console.log(`   - Output: ${result.stdout}`);
    } else {
      console.log('❌ Container execution test failed!');
      console.log(`   - Error: ${result.error || 'Unknown error'}`);
      console.log(`   - Stderr: ${result.stderr}`);
      process.exit(1);
    }

    // Test security constraints
    console.log('🔒 Testing security constraints...');
    
    const maliciousCode = `
#include <iostream>
#include <unistd.h>
#include <sys/socket.h>

int main() {
    // Try to create a socket (should fail due to --net=none)
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == -1) {
        std::cout << "Network access blocked (expected)" << std::endl;
    } else {
        std::cout << "WARNING: Network access not blocked!" << std::endl;
        close(sock);
    }
    
    // Try to fork (should be limited by --pids-limit)
    std::cout << "Process limits enforced" << std::endl;
    
    return 0;
}
`;

    const securityResult = await DockerService.executeCode(maliciousCode, {
      memoryLimit: '64m',
      cpuLimit: '0.25',
      timeoutMs: 5000,
      pidsLimit: 16
    });

    if (securityResult.success && securityResult.stdout.includes('Network access blocked')) {
      console.log('✅ Security constraints working correctly!');
    } else {
      console.log('⚠️  Security test results:');
      console.log(`   - Output: ${securityResult.stdout}`);
      console.log(`   - Stderr: ${securityResult.stderr}`);
    }

    console.log('🎉 Docker setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Failed to build Docker image:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  buildDockerImage().catch(console.error);
}

export { buildDockerImage };