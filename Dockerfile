FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
