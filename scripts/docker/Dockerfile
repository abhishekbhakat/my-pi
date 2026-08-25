# my-pi in Docker: install config into clean HOME, then run CMD.
# Build from repo root:
#   docker build -f scripts/docker/Dockerfile -t my-pi-test .
#   make docker-test
FROM node:22-alpine

RUN apk add --no-cache make git ca-certificates \
	&& npm install -g @earendil-works/pi-coding-agent@0.84.3

WORKDIR /workspace
COPY --chown=node:node . .

RUN chmod +x /workspace/scripts/docker/entrypoint.sh

USER node
ENV HOME=/home/node \
	NPM_CONFIG_UPDATE_NOTIFIER=false \
	NPM_CONFIG_FUND=false \
	PI_OFFLINE=0

ENTRYPOINT ["/workspace/scripts/docker/entrypoint.sh"]
# Default: config smoke test. Override with pi / sh for interactive use.
CMD ["node", "scripts/docker/smoke.mjs"]
