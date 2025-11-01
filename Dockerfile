FROM node:20-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production
RUN npm install -g nodemon

EXPOSE 3000

CMD ["nodemon", "--legacy-watch", "--ignore", "outputs", "--ignore", "tmp", "--ignore", "uploads", "server.js"]
