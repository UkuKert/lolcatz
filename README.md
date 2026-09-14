# can-i-haz-kubernetes

4chan-style image board running on Kubernetes.

**Production:** https://can-i-haz-kubernetes.ee-lte-1.codemowers.io

## Architecture

| Service | Language | Role |
|---|---|---|
| uploader | Go | Multipart upload → Minio + Postgres + Kafka |
| browse | Go | Board listing, thread view, comments |
| search | Go | Title/tag search (Postgres GIN index) |
| comments | Go | Post/delete comments |
| tagger | Python/YOLO | Kafka consumer → auto-tag images via YOLOv8 |
| frontend | Next.js 14 | UI, proxies API to backend services |

Images stored in Minio (`lolcatz-images` bucket), served publicly via `http://minio.ee-lte-1.codemowers.io`.
Metadata in Postgres (cnpg). Sessions in Dragonfly. Events via Redpanda.

## Local dev (docker-compose)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Uploader | http://localhost:8081 |
| Browse | http://localhost:8082 |
| Search | http://localhost:8083 |
| Comments | http://localhost:8084 |
| Minio console | http://localhost:9001 (minioadmin/minioadmin) |

## In-cluster dev (skaffold + kaniko)

Builds run inside the cluster via kaniko, push to `zot.ee-lte-1.codemowers.io`.

### Prerequisites

1. Get a zot API key: https://zot.ee-lte-1.codemowers.io → User Settings → API Keys

2. Create the push secret:
```bash
kubectl create ns lolcatz-foobar 2>/dev/null || true
kubectl create secret docker-registry zot-push-secret \
  -n lolcatz-foobar \
  --docker-server=zot.ee-lte-1.codemowers.io \
  --docker-username=<your-email> \
  --docker-password=<your-zot-api-key> \
  --dry-run=client -o yaml | kubectl apply -f -
```

3. Run skaffold:
```bash
SKAFFOLD_CACHE_FILE=/tmp/skaffold-cache.json \
SKAFFOLD_CONFIG=/tmp/skaffold-global.yaml \
skaffold dev --build-concurrency=1
```

## CI (Woodpecker)

Woodpecker at https://woodpecker.codemowers.io builds and pushes all images on push to `main`.

Required Woodpecker secret: `zot_docker_config` — a base64-encoded dockerconfig JSON:
```json
{"auths":{"zot.ee-lte-1.codemowers.io":{"username":"<email>","password":"<api-key>"}}}
```
