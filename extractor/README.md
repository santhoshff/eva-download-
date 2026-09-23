# Eva Extractor Microservice

A high-performance streaming bridge powered by `yt-dlp`, designed to handle video and audio extraction for **Eva Download**.

---

## Why Is This Needed?

Vercel and Cloudflare serverless edge functions operate on shared datacenter IP pools (AWS, Cloudflare, Azure, Google Cloud). Modern video platforms like YouTube actively flag and block requests originating from these IP ranges with **HTTP 403 Forbidden** or bot challenges.

Deploying this lightweight microservice on a residential or standard VPS (Hetzner, DigitalOcean, Linode, OVH, Oracle Cloud) completely sidesteps datacenter IP restrictions by routing extraction through dedicated server IPs.

---

## API Contract

| Endpoint | Method | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `/download` | `GET` | `url` (required), `format` (optional) | Streams video or extracted audio directly to the HTTP response with proper headers. |
| `/info` | `GET` | `url` (required) | Returns JSON metadata (title, formats, thumbnail, duration). |
| `/health` | `GET` | _None_ | Returns service uptime and `yt-dlp` version. |

### Download Examples
```bash
# Video download
curl -O -J "http://<YOUR_VPS_IP>:3000/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=best"

# Audio extraction (MP3)
curl -O -J "http://<YOUR_VPS_IP>:3000/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=audio"
```

---

## Deployment Option 1: Docker (Recommended)

Requires Docker & Docker Compose installed on your VPS.

### 1. Transfer the extractor folder to your VPS
```bash
scp -r extractor root@<YOUR_VPS_IP>:/opt/eva-extractor
ssh root@<YOUR_VPS_IP>
cd /opt/eva-extractor
```

### 2. Start the container
```bash
docker compose up -d --build
```

### 3. Verify it is running
```bash
curl http://localhost:3000/health
# Output: {"status":"ok","ytdlpVersion":"2024.xx.xx","uptimeSec":5,...}
```

---

## Deployment Option 2: Direct VPS (Ubuntu / Debian)

If you prefer running without Docker:

### 1. Install prerequisites
```bash
sudo apt update && sudo apt install -y curl ffmpeg python3 python3-pip

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### 2. Setup application
```bash
sudo mkdir -p /opt/eva-extractor
sudo cp -r . /opt/eva-extractor/
cd /opt/eva-extractor
npm install --omit=dev
```

### 3. Enable Systemd Service
```bash
sudo cp eva-extractor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eva-extractor
```

### 4. Check status & logs
```bash
sudo systemctl status eva-extractor
sudo journalctl -u eva-extractor -f
```

---

## Connecting to Eva Download (Vercel)

Once your extractor service is running:

1. Open your project on the **Vercel Dashboard** (or `.env.local` for local development).
2. Go to **Settings** > **Environment Variables**.
3. Add:
   ```env
   EVA_EXTRACTOR_URL=http://<YOUR_VPS_IP>:3000
   ```
   *(Or your HTTPS domain if you put Nginx/Caddy or Cloudflare in front of it: `https://extractor.yourdomain.com`)*
4. Redeploy your Vercel project.

All YouTube download requests will now be processed seamlessly by your extractor microservice!
