# Multi-stage Dockerfile for Render Web Service / Node.js Monorepo
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root configuration and package files
COPY package*.json tsconfig.base.json ./

# Copy all packages and apps
COPY packages ./packages
COPY apps ./apps

# Install all dependencies including devDependencies for tsc build
RUN npm install


# Generate Prisma Client & compile TypeScript workspace binaries
RUN npm run db:generate
RUN npm run build

# Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

# Copy root files, built packages, and node_modules from builder
COPY package*.json ./
COPY tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps

EXPOSE 10000

CMD ["node", "apps/api/dist/index.js"]
