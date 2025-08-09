#!/usr/bin/env tsx

import { DockerService } from '../lib/services/docker-service';
import { ContainerManager } from '../lib/services/container-manager';

async function testDockerIntegration() {
  console.log('🧪 Testing Docker Integration...\n');

  try {
    // Check Docker availability
    console.log('1. Checking Docker availability...');
    const { available, imageExists } = await DockerService.checkDockerAvailability();
    
    if (!available) {
      console.log('❌ Docker is not available. Please ensure Docker is installed and running.');
      console.log('   This is expected in environments without Docker.');
      return;
    }
    
    console.log('✅ Docker is available');

    // Build image if needed
    if (!imageExists) {
      console.log('2. Building Docker image...');
      await DockerService.buildImage();
      console.log('✅ Docker image built successfully');
    } else {
      console.log('2. Docker image already exists ✅');
    }

    // Test basic execution
    console.log('3. Testing basic C++ execution...');
    const basicCode = `
#include <iostream>
int main() {
    std::cout << "Hello from secure container!" << std::endl;
    return 0;
}`;

    const basicResult = await DockerService.executeCode(basicCode);
    if (basicResult.success) {
      console.log('✅ Basic execution test passed');
      console.log(`   Output: ${basicResult.stdout}`);
      console.log(`   Execution time: ${basicResult.executionTime}ms`);
    } else {
      console.log('❌ Basic execution test failed');
      console.log(`   Error: ${basicResult.error}`);
      console.log(`   Stderr: ${basicResult.stderr}`);
    }

    // Test compilation error handling
    console.log('4. Testing compilation error handling...');
    const errorCode = `
#include <iostream>
int main() {
    std::cout << "Missing semicolon" << std::endl
    return 0;
}`;

    const errorResult = await DockerService.executeCode(errorCode);
    if (!errorResult.success && errorResult.stderr.includes('error')) {
      console.log('✅ Compilation error handling test passed');
    } else {
      console.log('❌ Compilation error handling test failed');
    }

    // Test security constraints
    console.log('5. Testing security constraints...');
    const securityCode = `
#include <iostream>
#include <sys/socket.h>
#include <unistd.h>

int main() {
    // Test network isolation
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == -1) {
        std::cout << "Network access blocked (expected)" << std::endl;
    } else {
        std::cout << "WARNING: Network access not blocked!" << std::endl;
        close(sock);
    }
    
    // Test user ID
    uid_t uid = getuid();
    if (uid == 1000) {
        std::cout << "Running as non-root user (expected)" << std::endl;
    } else {
        std::cout << "WARNING: Not running as expected user!" << std::endl;
    }
    
    return 0;
}`;

    const securityResult = await DockerService.executeCode(securityCode);
    if (securityResult.success && 
        securityResult.stdout.includes('Network access blocked') &&
        securityResult.stdout.includes('Running as non-root user')) {
      console.log('✅ Security constraints test passed');
    } else {
      console.log('⚠️  Security constraints test results:');
      console.log(`   Output: ${securityResult.stdout}`);
      console.log(`   Stderr: ${securityResult.stderr}`);
    }

    // Test timeout enforcement
    console.log('6. Testing timeout enforcement...');
    const timeoutCode = `
#include <iostream>
#include <thread>
#include <chrono>
int main() {
    std::this_thread::sleep_for(std::chrono::seconds(15));
    std::cout << "This should not print" << std::endl;
    return 0;
}`;

    const timeoutResult = await DockerService.executeCode(timeoutCode, {
      memoryLimit: '64m',
      cpuLimit: '0.25',
      timeoutMs: 3000, // 3 seconds
      pidsLimit: 16
    });

    if (timeoutResult.timedOut) {
      console.log('✅ Timeout enforcement test passed');
      console.log(`   Execution time: ${timeoutResult.executionTime}ms`);
    } else {
      console.log('❌ Timeout enforcement test failed');
      console.log(`   Result: ${JSON.stringify(timeoutResult, null, 2)}`);
    }

    // Test container manager
    console.log('7. Testing container manager...');
    const manager = new ContainerManager({
      maxConcurrentContainers: 2,
      defaultTimeout: 5000
    });

    const jobId = 'test-job-' + Date.now();
    const managerResult = await manager.executeCode(jobId, basicCode);
    
    if (managerResult.success) {
      console.log('✅ Container manager test passed');
      
      const job = manager.getJob(jobId);
      if (job && job.status === 'completed') {
        console.log('✅ Job tracking test passed');
      }
      
      const metrics = manager.getSystemMetrics();
      console.log(`   System metrics: ${JSON.stringify(metrics, null, 2)}`);
    } else {
      console.log('❌ Container manager test failed');
    }

    await manager.shutdown();

    // Cleanup test
    console.log('8. Testing cleanup...');
    await DockerService.cleanupAllContainers();
    const remainingContainers = await DockerService.listRunningContainers();
    
    if (remainingContainers.length === 0) {
      console.log('✅ Cleanup test passed');
    } else {
      console.log(`⚠️  ${remainingContainers.length} containers still running after cleanup`);
    }

    console.log('\n🎉 Docker integration tests completed!');

  } catch (error) {
    console.error('❌ Docker integration test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  testDockerIntegration().catch(console.error);
}

export { testDockerIntegration };