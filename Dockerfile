FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
