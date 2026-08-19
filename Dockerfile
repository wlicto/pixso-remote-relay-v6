FROM node:24-alpine
WORKDIR /app
COPY package.json relay.mjs ./
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "relay.mjs"]
