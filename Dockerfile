FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install && npm audit fix || true

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["node", "server/index.js"]
