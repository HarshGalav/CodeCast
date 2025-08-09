# Secure C++ Execution Container

This Docker container provides a secure, isolated environment for compiling and executing C++ code with strict security policies and resource limits.

## Security Features

### Container Isolation
- **Network Isolation**: `--net=none` prevents all network access
- **Read-only Filesystem**: Root filesystem is mounted read-only
- **Non-root User**: Code runs as user `coderunner` (UID 1000)
- **No New Privileges**: `--no-new-privileges` prevents privilege escalation
- **Capability Dropping**: All Linux capabilities are dropped

### Resource Limits
- **Memory Limit**: Configurable (default: 128MB)
- **CPU Limit**: Configurable (default: 0.5 cores)
- **Process Limit**: `--pids-limit` prevents fork bombs
- **Execution Timeout**: Configurable (default: 10 seconds)

### Filesystem Security
- **Read-only Root**: Prevents modification of system files
- **Temporary Workspace**: `/tmp` is available for compilation artifacts
- **No Dangerous Binaries**: Network tools (wget, curl, nc) are removed

## Container Architecture

```
alpine:3.19 (minimal base)
├── g++ (C++ compiler)
├── libc-dev (standard library)
├── coderunner user (UID 1000)
└── /app/workspace (working directory)
```

## Usage

### Building the Image
```bash
npm run docker:build
```

### Direct Docker Usage
```bash
# Build the image
docker build -t cpp-executor docker/cpp-executor/

# Run with security constraints
docker run --rm \
  --net=none \
  --memory=128m \
  --cpus=0.5 \
  --pids-limit=32 \
  --no-new-privileges \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=10m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --user 1000:1000 \
  -v /path/to/code.cpp:/app/workspace/main.cpp:ro \
  cpp-executor \
  /bin/sh -c "cd /tmp && cp /app/workspace/main.cpp . && g++ -o main main.cpp && ./main"
```

### Programmatic Usage
```typescript
import { DockerService } from '../lib/services/docker-service';

const code = `
#include <iostream>
int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`;

const result = await DockerService.executeCode(code, {
  memoryLimit: '64m',
  cpuLimit: '0.25',
  timeoutMs: 5000,
  pidsLimit: 16
});

console.log(result.stdout); // "Hello, World!"
```

## Security Testing

The container includes several security tests to verify isolation:

### Network Isolation Test
```cpp
#include <sys/socket.h>
int main() {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    // Should fail with -1 due to --net=none
    return sock == -1 ? 0 : 1;
}
```

### Filesystem Protection Test
```cpp
#include <fstream>
int main() {
    std::ofstream file("/etc/passwd");
    // Should fail due to read-only filesystem
    return file.is_open() ? 1 : 0;
}
```

### User Privilege Test
```cpp
#include <unistd.h>
int main() {
    // Should return 1000 (non-root)
    return getuid() == 1000 ? 0 : 1;
}
```

## Resource Monitoring

The container supports real-time resource monitoring:

```typescript
const metrics = await DockerService.getContainerMetrics(containerId);
console.log({
  memoryUsage: metrics.memoryUsage,
  cpuUsage: metrics.cpuUsage,
  pidsCount: metrics.pidsCount
});
```

## Error Handling

The container handles various error scenarios:

- **Compilation Errors**: Captured in stderr
- **Runtime Errors**: Exit code and stderr captured
- **Timeout**: Process killed after configured timeout
- **Memory Limit**: Container killed if memory exceeded
- **Resource Exhaustion**: Proper cleanup and error reporting

## Best Practices

1. **Always use resource limits** to prevent resource exhaustion
2. **Set appropriate timeouts** to prevent hanging processes
3. **Monitor container metrics** for resource usage patterns
4. **Regular cleanup** of stopped containers and temporary files
5. **Log security events** for audit purposes

## Troubleshooting

### Container Won't Start
- Check Docker daemon is running
- Verify image exists: `docker images | grep cpp-executor`
- Check available system resources

### Compilation Fails
- Verify C++ code syntax
- Check for missing headers or libraries
- Review compiler error messages in stderr

### Execution Timeout
- Increase timeout limit if legitimate
- Check for infinite loops in code
- Monitor CPU usage patterns

### Memory Issues
- Increase memory limit if needed
- Check for memory leaks in code
- Monitor memory usage patterns

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never disable security features** in production
2. **Always run with minimal privileges**
3. **Regularly update base image** for security patches
4. **Monitor for escape attempts** in logs
5. **Validate all user input** before execution
6. **Use separate containers** for each execution
7. **Clean up immediately** after execution

## Performance Tuning

- **Memory**: Start with 64MB, increase if needed
- **CPU**: 0.25-0.5 cores usually sufficient
- **Timeout**: 5-10 seconds for most programs
- **PIDs**: 16-32 processes usually sufficient

## Compliance

This container setup addresses security requirements:
- **Requirement 5.1**: Network isolation with `--net=none`
- **Requirement 5.2**: Memory limits enforced
- **Requirement 5.3**: CPU limits enforced  
- **Requirement 5.4**: Process limits with `--pids-limit`
- **Requirement 5.5**: No privilege escalation
- **Requirement 5.6**: Non-root execution
- **Requirement 5.7**: Immediate container destruction