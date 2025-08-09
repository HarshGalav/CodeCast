# Secure C++ execution environment
FROM alpine:3.19

# Install minimal dependencies for C++ compilation
RUN apk add --no-cache \
    g++ \
    libc-dev \
    && rm -rf /var/cache/apk/*

# Create non-root user for code execution
RUN addgroup -g 1000 coderunner && \
    adduser -D -s /bin/sh -u 1000 -G coderunner coderunner

# Create secure working directory
RUN mkdir -p /app/workspace && \
    chown coderunner:coderunner /app/workspace && \
    chmod 755 /app/workspace

# Remove unnecessary binaries and tools that could be exploited
RUN rm -rf /usr/bin/wget /usr/bin/curl /bin/nc /usr/bin/telnet 2>/dev/null || true

# Set working directory
WORKDIR /app/workspace

# Switch to non-root user
USER coderunner

# Default command (will be overridden)
CMD ["/bin/sh"]