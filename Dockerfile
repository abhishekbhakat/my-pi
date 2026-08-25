# Moved to scripts/docker/Dockerfile
# Build with:
#   make docker-build
#   docker build -f scripts/docker/Dockerfile -t my-pi-test .
FROM scratch
LABEL org.opencontainers.image.description="Use scripts/docker/Dockerfile (make docker-build)"
