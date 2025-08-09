import { jobProcessor } from '@/lib/services/job-processor';

/**
 * Initialize the job processor
 * This should be called when the application starts
 */
export async function initJobProcessor(): Promise<void> {
  try {
    console.log('Initializing job processor...');
    await jobProcessor.start();
    console.log('Job processor initialized successfully');
  } catch (error) {
    console.error('Failed to initialize job processor:', error);
    throw error;
  }
}

/**
 * Shutdown the job processor
 * This should be called when the application shuts down
 */
export async function shutdownJobProcessor(): Promise<void> {
  try {
    console.log('Shutting down job processor...');
    await jobProcessor.stop();
    console.log('Job processor shut down successfully');
  } catch (error) {
    console.error('Failed to shutdown job processor:', error);
    throw error;
  }
}

// Handle process termination
if (typeof process !== 'undefined') {
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await shutdownJobProcessor();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await shutdownJobProcessor();
    process.exit(0);
  });
}