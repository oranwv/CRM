FROM node:20-alpine

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
