# syntax=docker/dockerfile:1.6
# Blink backend — Node.js service for Fly.io deploy.
# Build: flyctl deploy --build-arg CLOUDSMITH_TOKEN=<token>

FROM node:20-alpine AS builder
WORKDIR /app

# Circle's @circlefin/x402-batching package lives on a private Cloudsmith
# registry. The .npmrc references ${CLOUDSMITH_TOKEN} via env-var expansion,
# so we pass the token in as a build arg for the install step only.
ARG CLOUDSMITH_TOKEN
ENV CLOUDSMITH_TOKEN=$CLOUDSMITH_TOKEN

COPY .npmrc package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app

# Copy only the installed modules from the builder so the CLOUDSMITH_TOKEN
# never lands in the final runtime image layer.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json server.js blink-contract-abi.json ./

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
