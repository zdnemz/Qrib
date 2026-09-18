FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
