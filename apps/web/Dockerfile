FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm install
RUN npm run build:packages
ENV NEXT_TELEMETRY_DISABLED=1
ARG API_PROXY_ORIGIN=http://api:4000
ENV API_PROXY_ORIGIN=$API_PROXY_ORIGIN
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm --workspace apps/web run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV API_PROXY_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Next.js standalone output bundles the server + minimal node_modules.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
