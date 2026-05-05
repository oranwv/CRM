FROM node:20-alpine

# Install Chromium early — this layer is cached by Railway after the first build.
# Subsequent code-only deploys skip this step entirely.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Install server deps
COPY package*.json ./
RUN npm ci --omit=dev

# Install client deps and build
COPY client/package*.json ./client/
RUN cd client && npm ci

COPY . .
RUN cd client && npm run build

EXPOSE 3001
CMD ["node", "server/index.js"]
