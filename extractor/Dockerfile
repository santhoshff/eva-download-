# Eva Extractor Microservice Dockerfile
# Provides Node.js 20, Python 3, FFmpeg, and yt-dlp

FROM node:20-alpine

# Install system dependencies: Python 3, FFmpeg, curl, and CA certs
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && ln -sf python3 /usr/bin/python

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy dependency definitions and install production packages
COPY package.json ./
RUN npm install --omit=dev

# Copy application source
COPY server.js ./

# Set environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start microservice
CMD ["node", "server.js"]
