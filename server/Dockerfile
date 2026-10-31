FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4180
WORKDIR /app/server
COPY --from=dependencies --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/package.json ./
COPY --chown=node:node server/src ./src
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 4180
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4180/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
