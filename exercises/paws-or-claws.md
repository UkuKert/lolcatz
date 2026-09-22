# Paws or Claws 👍👎

Build a Kubernetes-native Python service that adds real-time voting to Lolcatz.

## Goal

Users can give each image a thumbs-up or thumbs-down vote. When somebody votes, every browser displaying that image receives the new totals immediately without refreshing the page.

The exercise demonstrates:

- building an HTTP service with Sanic;
- storing votes durably in PostgreSQL;
- enforcing one vote per authenticated user with a database constraint;
- publishing application updates with MQTT;
- delivering real-time browser updates through EMQX over WebSockets;
- declaring an EMQX instance with a Kubernetes custom resource;
- exposing a secure WebSocket endpoint through Ingress and TLS;
- containerizing and deploying a Python service to Kubernetes; and
- using Skaffold for a fast edit, build and deploy loop.

## Architecture

```text
Browser ──authenticated HTTP vote──▶ Sanic voting service ──INSERT──▶ PostgreSQL
   ▲                         │
   │                         └──MQTT publish──▶ EMQX
   │                                                │
   └──── MQTT over secure WebSocket via Ingress ────┘
```

PostgreSQL stores the authoritative votes. Sanic validates the caller's access token and identifies the voter from the token's issuer and immutable `sub` claim. A database uniqueness constraint ensures that the same identity cannot vote twice on the same image. After committing a vote, Sanic reads the new totals and publishes them to EMQX. Browser clients subscribe to image-specific MQTT topics through EMQX's WebSocket listener.

EMQX owns the long-lived browser connections and message fan-out, so Sanic remains a stateless HTTP service and can be scaled without coordinating WebSocket clients between replicas.

The EMQX Operator is already installed in the cluster. The application chart must declare its own `EMQX` custom resource, listener Service and Ingress. TLS terminates at the Ingress, and browsers connect using `wss://`.

Vote totals are publicly readable. Anonymous browser clients may use the HTTP read endpoint and subscribe to `lolcatz/images/+/votes`, but they may not publish or cast votes. Voting requires the existing Lolcatz OIDC session. Only the Sanic service receives credentials that permit publication to vote topics.

An IP address, browser cookie or `localStorage` value is not a reliable unique identity. A user can clear local state, change browsers or share an IP address. Requiring authentication and enforcing uniqueness against the OIDC subject is what makes the one-vote rule authoritative.

## API contract

### Record a vote

```http
POST /images/{image_id}/vote
Content-Type: application/json
Authorization: Bearer {access_token}

{
  "vote": "up"
}
```

`vote` must be either `up` or `down`.

The first vote returns HTTP `201`. A second vote by the same identity for the same image returns HTTP `409 Conflict`, regardless of whether it repeats or changes the original choice.

Example response:

```json
{
  "image_id": "01JABC123",
  "up": 12,
  "down": 3
}
```

### Read vote totals

```http
GET /images/{image_id}/votes
```

Example response:

```json
{
  "image_id": "01JABC123",
  "up": 12,
  "down": 3
}
```

### Subscribe to live totals with MQTT

```text
WebSocket endpoint: wss://{mqtt_host}/mqtt
MQTT topic:        lolcatz/images/{image_id}/votes
```

The frontend connects with MQTT.js and subscribes to the topic for the displayed image. Sanic publishes the same JSON representation returned by its HTTP API after every successful vote.

Publish the latest totals as a retained MQTT message. A newly connected browser then receives the current state immediately. The HTTP `GET` endpoint remains the authoritative fallback after connection or decoding failures.

### Health check

```http
GET /healthz
```

The endpoint returns a successful response when the process is running. A follow-up task can add a separate readiness endpoint that checks PostgreSQL and EMQX connectivity.

## PostgreSQL data model

Store one row per voter and image:

```sql
CREATE TABLE image_votes (
    image_id  TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    voter_id  TEXT NOT NULL,
    vote      SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (image_id, voter_id)
);
```

Use `1` for thumbs-up and `-1` for thumbs-down. `voter_id` is derived from the verified OIDC issuer and subject, for example `iss + "|" + sub`. Do not trust a voter identifier supplied in the request body.

Insert the vote without a read-before-write race:

```sql
INSERT INTO image_votes (image_id, voter_id, vote)
VALUES ($1, $2, $3);
```

The primary key is the final authority. If two requests from the same user arrive concurrently, PostgreSQL accepts one and rejects the other with a unique-constraint violation. Sanic maps that violation to HTTP `409 Conflict`.

Read public totals with conditional aggregation:

```sql
SELECT
    COUNT(*) FILTER (WHERE vote = 1)  AS up,
    COUNT(*) FILTER (WHERE vote = -1) AS down
FROM image_votes
WHERE image_id = $1;
```

Commit the insert before publishing. EMQX is a notification channel, not the source of truth; clients can always recover by calling the public `GET` endpoint.

Publish the updated representation after a successful vote:

```text
Topic:   lolcatz/images/01JABC123/votes
QoS:     1
Retain:  true
Payload: {"image_id":"01JABC123","up":12,"down":3}
```

## Kubernetes resources

Add the following resources to the application's Helm chart:

1. An `apps.emqx.io/v2` `EMQX` custom resource with an MQTT-over-WebSocket listener.
2. A listener Service exposing the EMQX WebSocket port inside the cluster.
3. An Ingress routing `/mqtt` to that listener Service.
4. A TLS certificate and secret for the public MQTT hostname.
5. EMQX authorization rules allowing anonymous subscriptions to `lolcatz/images/+/votes` while denying anonymous publication.
6. A Secret containing the Sanic service's MQTT publisher credentials.

The public endpoint must use `wss://`. TLS may terminate at the Ingress, with ordinary WebSocket traffic between the Ingress controller and the EMQX Service. The Ingress must preserve WebSocket upgrade headers.

## Participant tasks

1. Add the `image_votes` table and its one-vote-per-user primary key.
2. Verify the access token in Sanic and derive the voter ID from its issuer and subject claims.
3. Implement the Sanic endpoint that validates and inserts an up or down vote.
4. Map duplicate-vote constraint violations to HTTP `409 Conflict`.
5. Implement the public endpoint that returns aggregate totals for an image.
6. Add an EMQX custom resource and its listener Service to the Helm chart.
7. Expose the WebSocket listener through a TLS-enabled Ingress.
8. Publish the committed totals to the image's MQTT topic.
9. Subscribe from the frontend using MQTT.js over `wss://`.
10. Run the application through Skaffold and verify live updates in two authenticated browser sessions.

## Provided scaffolding

To keep the exercise achievable during the workshop, provide:

- a starter Sanic application with TODO markers;
- frontend vote buttons and starter MQTT.js client code;
- Python dependencies and a Dockerfile;
- starter Kubernetes Deployment and Service templates;
- a Skaffold artifact entry;
- the PostgreSQL connection URL through an environment variable;
- access to the existing OIDC issuer and frontend token-forwarding pattern;
- the public MQTT hostname and certificate issuer; and
- documentation for the installed EMQX Operator's custom resource.

Participants configure the EMQX instance and secure Ingress as part of the application, but do not install the cluster-wide Operator.

## Acceptance criteria

- An authenticated user's first 👍 increments only the `up` total.
- An authenticated user's first 👎 increments only the `down` total.
- Invalid vote values receive an HTTP `400` response.
- Unauthenticated vote requests receive HTTP `401`.
- A second vote on the same image by the same OIDC identity receives HTTP `409`.
- Concurrent duplicate requests still create exactly one database row.
- Reloading the page preserves the totals.
- Two browser windows displaying the same image update without a refresh.
- The service runs in Kubernetes and is reachable through the frontend.
- The MQTT endpoint is exposed only through `wss://` with a valid certificate.
- A newly connected browser receives the retained current totals.
- Anonymous clients can subscribe to vote topics but cannot publish to them.
- Live updates still work after scaling the Sanic voting service to two replicas.

## Optional follow-up tasks

1. Allow users to change their vote while retaining only one row per user and image.
2. Add a leaderboard ordered by each image's aggregate score.
3. Add readiness checks, resource limits and graceful MQTT client shutdown.
4. Explore the EMQX custom resource, listener status and authorization policy.
5. Scale and restart the Sanic and EMQX workloads while observing client reconnection.

## Why use PostgreSQL and EMQX together?

PostgreSQL provides durable votes, referential integrity and race-free uniqueness enforcement. EMQX specializes in long-lived connections, topic routing, retained messages, reconnecting clients and real-time fan-out. Keeping persistence and delivery separate leaves the Python service small and stateless.

EMQX speaks MQTT over WebSocket rather than plain application WebSocket messages. The frontend therefore uses MQTT.js and gains MQTT topic, QoS and retained-message semantics while still connecting through a standard secure WebSocket endpoint.
