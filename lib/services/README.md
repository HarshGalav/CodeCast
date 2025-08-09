# Job Queue System

This directory contains the implementation of the job queue system for secure C++ code compilation and execution.

## Components

### ExecutionService (`execution-service.ts`)
The main service for managing compilation jobs with the following features:
- Job queuing with Bull Queue and Redis
- Rate limiting (5 jobs per user per minute)
- Job priority management
- Timeout handling and error recovery
- Job status tracking and result storage

### JobProcessor (`job-processor.ts`)
Background processor that handles:
- Timeout monitoring (every 30 seconds)
- Cleanup of old jobs (every 10 minutes)
- Health checks and status reporting
- Graceful shutdown handling

### Redis Configuration (`../config/redis-config.ts`)
Redis connection management with:
- Connection pooling
- Error handling and reconnection
- Health checks

## Usage

### Starting the Job Processor
```typescript
import { initJobProcessor } from '@/lib/init-job-processor';

// Initialize when your application starts
await initJobProcessor();
```

### Queuing a Job
```typescript
import { ExecutionService } from '@/lib/services/execution-service';

const executionService = ExecutionService.getInstance();

const jobId = await executionService.queueJob(
  'room-id',
  'user-id',
  '#include <iostream>\nint main() { std::cout << "Hello"; return 0; }',
  {
    flags: ['-std=c++17', '-Wall'],
    timeout: 30000,
    memoryLimit: '128m',
    cpuLimit: '0.5'
  }
);
```

### Checking Job Status
```typescript
const status = await executionService.getJobStatus(jobId);

console.log(status.status); // 'queued', 'running', 'completed', 'failed', 'timeout'
console.log(status.result); // ExecutionResult if completed
console.log(status.position); // Queue position if queued
```

### Cancelling a Job
```typescript
const cancelled = await executionService.cancelJob(jobId, userId);
```

## API Endpoints

### POST /api/compile
Queue a new compilation job.

**Request:**
```json
{
  "roomId": "uuid",
  "userId": "string",
  "code": "C++ code string",
  "options": {
    "flags": ["-std=c++17", "-Wall"],
    "timeout": 30000,
    "memoryLimit": "128m",
    "cpuLimit": "0.5"
  }
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "status": "queued",
  "message": "Compilation job queued successfully"
}
```

### GET /api/compile/[jobId]
Get job status and results.

**Response:**
```json
{
  "jobId": "uuid",
  "status": "completed",
  "position": null,
  "result": {
    "success": true,
    "stdout": "Hello",
    "stderr": "",
    "exitCode": 0,
    "executionTime": 1500,
    "memoryUsed": 1024,
    "timedOut": false
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### DELETE /api/compile/[jobId]?userId=string
Cancel a job.

**Response:**
```json
{
  "jobId": "uuid",
  "status": "cancelled",
  "message": "Job cancelled successfully"
}
```

### GET /api/health/queue
Check job queue health.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "redis": "up",
    "processor": "running"
  },
  "queueStats": {
    "waiting": 0,
    "active": 1,
    "completed": 10,
    "failed": 0,
    "delayed": 0
  }
}
```

## Configuration

### Environment Variables
- `REDIS_URL`: Redis connection URL (default: redis://localhost:6379)
- `MAX_EXECUTION_TIME`: Maximum execution time in ms (default: 30000)
- `MAX_MEMORY_LIMIT`: Maximum memory limit (default: 128m)
- `MAX_CPU_LIMIT`: Maximum CPU limit (default: 0.5)

### Rate Limits
- Maximum 5 jobs per user per minute
- Maximum 3 concurrent jobs processing
- Maximum 100 jobs in queue

### Job Priorities
- HIGH: 10 (reserved for future use)
- NORMAL: 5 (default)
- LOW: 1 (reserved for future use)

## Security Features

### Container Isolation
- Network disabled (`--net=none`)
- Memory limits enforced
- CPU limits enforced
- Process limits (`--pids-limit`)
- No new privileges (`--no-new-privileges`)
- Read-only filesystem
- Non-root user execution

### Input Validation
- Code sanitization
- Option validation with Zod schemas
- SQL injection prevention
- Rate limiting and abuse prevention

## Monitoring and Observability

### Health Checks
- Redis connectivity
- Queue processor status
- Queue statistics

### Logging
- Job lifecycle events
- Error tracking
- Performance metrics

### Cleanup
- Automatic cleanup of old completed jobs (7 days)
- Queue cleanup of completed/failed jobs (1 hour)
- Container cleanup after execution

## Error Handling

### Job Failures
- Compilation errors
- Runtime errors
- Timeout errors
- Memory limit exceeded
- System errors

### Recovery Mechanisms
- Automatic job retry (3 attempts with exponential backoff)
- Timeout monitoring and cleanup
- Graceful degradation
- Error logging and reporting

## Testing

Run the job queue tests:
```bash
npm test -- --testPathPattern="execution-service|job-processor|job-queue-integration"
```

## Development

### Local Setup
1. Start Redis: `redis-server`
2. Start the job processor: `await initJobProcessor()`
3. Queue jobs via API or service directly

### Debugging
- Check Redis connection: `redis-cli ping`
- Monitor queue: Redis Commander or similar tool
- Check logs for job processing events
- Use health check endpoint for status