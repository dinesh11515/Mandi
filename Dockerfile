FROM node:22-slim
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL=
ARG VITE_WORLD_APP_ID=
ENV VITE_API_URL=$VITE_API_URL VITE_WORLD_APP_ID=$VITE_WORLD_APP_ID
RUN pnpm --filter @mandi/web build
ENV WEB_DIST=../web/dist PORT=3000
WORKDIR /app/server
EXPOSE 3000
CMD ["pnpm", "start"]
