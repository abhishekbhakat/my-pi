FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
ENV SESSION_DB=/data/session.sqlite
CMD ["npm", "start"]
