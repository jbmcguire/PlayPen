FROM node:22-alpine

WORKDIR /app
ENV HOST=0.0.0.0
ENV PORT=4177
ENV PLAYPEN_STORE_DIR=/data/playpen-store

COPY --chown=node:node package.json ./
COPY --chown=node:node app.js env-doctor.js index.html inspect-link.js openapi.json production-preflight.js publish-file.js server.js smoke-local.js storage.js styles.css vercel.json verify-host.js ./

RUN mkdir -p /data/playpen-store && chown -R node:node /app /data

USER node

VOLUME ["/data"]
EXPOSE 4177

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4177) + '/api/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
