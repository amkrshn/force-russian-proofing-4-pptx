# Production deployment

This document describes the recommended production deployment for **Force RussianProofing4PPTX** on an internal Linux server.

## Recommended topology

```text
Browser / third-party service
       |
       | HTTPS
       v
   Nginx :443
       |
       | private Docker network
       v
 FastAPI + React :8000
       |
       v
 temporary files in container /tmp
```

The service is intentionally stateless. Uploaded and generated presentations are temporary and are not stored in a database.

## 1. Server prerequisites

Recommended baseline:

- current supported Linux distribution;
- Docker Engine;
- Docker Compose v2 plugin;
- internal DNS record for the service;
- TLS certificate from the corporate PKI or another trusted CA;
- access restricted to the corporate network/VPN or an authenticated reverse proxy.

The application itself does **not** implement user authentication. Do not expose it directly to the public Internet without an authentication layer.

## 2. Prepare the host

Example installation directory:

```bash
sudo mkdir -p /opt/force-russian-proofing-4-pptx
sudo chown "$USER":"$USER" /opt/force-russian-proofing-4-pptx
cd /opt/force-russian-proofing-4-pptx
```

Clone the private repository and check out the required release/commit.

## 3. Production environment

Create the production environment file:

```bash
cp deploy/.env.prod.example deploy/.env.prod
```

At minimum set:

```dotenv
SERVER_NAME=pptx-proofing.company.local
ALLOWED_HOSTS=pptx-proofing.company.local,app,localhost,127.0.0.1
CORS_ORIGINS=https://pptx-proofing.company.local,https://host-service.company.local
```

For the recommended same-origin third-party service proxy integration, `CORS_ORIGINS` can be left empty because the browser talks only to the host service origin.

### Processing limits

`MAX_UPLOAD_BYTES` is the application-level upload limit. `NGINX_CLIENT_MAX_BODY_SIZE` must be slightly larger to allow multipart overhead.

The default limits are:

- application upload: 100 MB;
- nginx body size: 110 MB;
- unpacked OOXML package: 500 MB;
- concurrent conversion jobs: 2;
- temporary job TTL: 1 hour.

For a server with limited RAM, keep `MAX_CONCURRENT_JOBS=1` or `2`.

## 4. TLS

Copy the certificate and key:

```text
deploy/certs/tls.crt
deploy/certs/tls.key
```

The private key must never be committed to Git.

If the organization already has an ingress, load balancer, WAF, or central Nginx that terminates TLS and provides SSO, use that layer instead of the bundled Nginx. Proxy requests to the application container on port `8000` over a private network.

## 5. Validate and start

Validate Compose rendering first:

```bash
docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  config
```

Build and start:

```bash
docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  up -d --build
```

Check status:

```bash
docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  ps
```

Health endpoint:

```text
https://<SERVER_NAME>/api/health
```

Expected response contains `status: ok`.

## 6. Logs

```bash
docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  logs -f --tail=200
```

The application does not intentionally log presentation contents. Reverse-proxy access logs may still contain request metadata such as timestamps, source IPs, URLs, and HTTP status codes.

## 7. Automatic startup with systemd

A sample unit is included at:

```text
deploy/systemd/force-russian-proofing.service
```

It assumes the repository is deployed to:

```text
/opt/force-russian-proofing-4-pptx
```

Install it:

```bash
sudo cp deploy/systemd/force-russian-proofing.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now force-russian-proofing
```

## 8. Updating

Recommended update sequence:

```bash
cd /opt/force-russian-proofing-4-pptx
git pull --ff-only

docker compose \
  --env-file deploy/.env.prod \
  -f docker-compose.prod.yml \
  up -d --build
```

Because the service is stateless, there is no application database migration step.

## 9. Rollback

Check out the previously known-good commit/tag and rebuild:

```bash
git checkout <known-good-tag-or-commit>
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml up -d --build
```

## 10. Security model

The production Compose stack adds the following controls:

- FastAPI `TrustedHostMiddleware`;
- optional CORS allow-list;
- production API docs disabled by default;
- non-root application container;
- read-only application root filesystem;
- temporary writable storage only under `/tmp`;
- dropped Linux capabilities for the application container;
- ZIP entry, unpacked-size, and compression-ratio checks;
- upload rate limiting in Nginx;
- TLS 1.2/1.3;
- HSTS and basic browser security headers;
- server-side concurrency limit;
- automatic deletion after successful download and TTL cleanup for abandoned jobs.

### Authentication

Authentication and authorization should be supplied by the surrounding corporate platform:

1. preferred: the surrounding third-party service authenticates the user and reverse-proxies this service under the same origin;
2. acceptable: corporate ingress authenticates requests using SSO/OIDC before forwarding them;
3. not recommended: direct anonymous access to the service from outside a trusted network.

## 11. Capacity notes

The service uses one FastAPI/Uvicorn worker intentionally because job state is currently held in process memory. `MAX_CONCURRENT_JOBS` limits simultaneous conversions within that worker.

For horizontal scaling, replace the in-memory job store with Redis or another shared state store and place temporary PPTX files in shared/object storage. Only then increase the number of application replicas/workers.
