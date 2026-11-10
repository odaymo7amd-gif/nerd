FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787

# ffmpeg الثنائي يأتي من الحزم، وtesseract يعمل محليًا. لا حاجة لمفتاح AI على الخادم.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /data/uploads /data/tmp /data/ocr-cache

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
