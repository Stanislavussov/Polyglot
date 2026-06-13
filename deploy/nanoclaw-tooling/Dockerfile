FROM node:26-alpine

RUN apk add --no-cache bash git \
  && npm install -g pnpm@10.14.0

WORKDIR /workspace

ENV CI=true
