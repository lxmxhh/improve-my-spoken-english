# Caddy HTTPS Deployment

Use Caddy to expose the Next.js production server over HTTPS so mobile browsers can access the microphone.

## 1. Point DNS to the server

Create an `A` record for your domain:

```text
your-domain.com -> 47.236.190.244
```

Caddy needs a real domain name for automatic trusted HTTPS certificates. A bare IP address such as `http://47.236.190.244:6688` is not enough for mobile microphone access.

## 2. Start the app in production mode

Run the app on the server:

```bash
npm run build
npm run start -- -p 6688
```

## 3. Configure Caddy

Install Caddy, then copy `deploy/Caddyfile.example` to your server Caddy config path and replace `your-domain.com` with your real domain.

Typical Linux path:

```bash
/etc/caddy/Caddyfile
```

Config:

```caddyfile
your-domain.com {
  encode zstd gzip

  reverse_proxy 127.0.0.1:6688
}
```

## 4. Open firewall ports

Allow these inbound ports:

```text
80/tcp
443/tcp
```

Keep `6688/tcp` private if possible. Caddy should be the public entry point.

## 5. Restart Caddy

```bash
sudo systemctl reload caddy
```

Then open:

```text
https://your-domain.com/session
```
