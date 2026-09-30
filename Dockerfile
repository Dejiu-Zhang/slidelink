FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3000 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
