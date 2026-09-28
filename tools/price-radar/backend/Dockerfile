FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY extract.mjs browserbase.mjs worker.mjs ./
USER node
CMD ["node", "worker.mjs"]
