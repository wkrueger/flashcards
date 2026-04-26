# Deploying on a VPS with pm2 + nginx

## Prerequisites

- Node.js 20+ and pnpm on the server
- pm2 installed globally (`npm i -g pm2`)
- nginx installed
- A domain pointed at the server's IP

## 1. Build

On the server (or locally, then rsync):

```bash
pnpm install --frozen-lockfile
pnpm build
```

## 2. Environment

Create `packages/server/.env`:

```env
NODE_ENV=production
DATABASE_URL="file:/absolute/path/to/cards/packages/server/prisma/prod.db"
BETTER_AUTH_SECRET="<random 32+ char string>"
BETTER_AUTH_URL="https://yourdomain.com"
SERVER_PORT=3001
CLIENT_ORIGIN="https://yourdomain.com"
OPENAI_API_KEY="sk-..."
DISABLE_USER_CREATION=true
```

## 3. Start with pm2

```bash
cd /absolute/path/to/cards

# Export env vars so pm2 inherits them
export $(grep -v '^#' packages/server/.env | xargs)

pm2 start packages/server/dist/main.js --name cards-server
pm2 save
pm2 startup   # follow the printed command to enable start on reboot
```

## 4. Configure nginx

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    root /absolute/path/to/cards/packages/client/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse-proxy tRPC and auth to Fastify
    location /trpc {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

## 5. TLS (Let's Encrypt)

```bash
certbot --nginx -d yourdomain.com
```

`secure: true` on session cookies is automatically enforced because `NODE_ENV=production` is set.

## 6. Subsequent deployments

```bash
git pull
pnpm install --frozen-lockfile
pnpm build
pm2 restart cards-server
```
