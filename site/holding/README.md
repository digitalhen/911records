# 911records.nyc holding page

Static page served by nginx. No JavaScript, cookies, analytics or forms.

    docker build -t 911records-holding site/holding
    docker run --rm -p 8080:80 911records-holding   # http://localhost:8080

Dokploy: create an application whose build context is `site/holding` (Dockerfile build),
container port 80, domain `911records.nyc` (and `www.911records.nyc` redirecting to it), HTTPS via
Dokploy's Let's Encrypt. Health check: `GET /healthz`.
