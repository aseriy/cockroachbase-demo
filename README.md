# semgrep

A demo application for self-hosted [Supabase](https://supabase.com) running on [CockroachDB](https://www.cockroachlabs.com). Messages typed into a web page are embedded by the `gte-small` model running inside the platform's edge runtime, stored in a native `VECTOR(384)` column, and searched by vector distance directly in the database.

No external AI service is involved: the embedding model runs in the edge runtime, the vectors live in CockroachDB, and the page ships in the same container as the message generator. The application deploys as one manifest file plus one container image.

## How it works

- **`semgrep`** — the application container. nginx serves the web page (the anon key and the gateway URL are baked into it at container start), and the message-generator loop runs beside it, POSTing generated messages to the same API the page uses to keep the feed moving. The page calls the platform's APIs cross-origin; the envoy gateway answers the CORS preflights, so there is no CORS configuration in this repository.
- **`semgrep-api`** — an edge function with two operations. Add: embed the message with `Supabase.ai.Session('gte-small')` and insert the row with text and vector together. Search: embed the query text the same way and return rows ranked by cosine distance, via the `search_messages` SQL function.
- **Schema** — one `messages` table with a `VECTOR(384)` column, plus the `search_messages` function, both owned by the platform's conventions and readable/callable by the API roles.



## Repository layout

```
Makefile              build and packaging targets
ui/                   SOURCE — the web UI (React + Vite)
functions/
  semgrep-api/index.ts SOURCE — the add/search function
generator/            SOURCE — the semgrep container: the generator package,
                      Dockerfile, nginx.conf, entrypoint.sh
                      (index.html is staged here by `make image`; gitignored)
schema/
  schema.sql          SOURCE — table, search function, grants
build/                GENERATED — bundle, manifest parts (gitignored)
crs/                  GENERATED — the single deployable manifest (gitignored)
```

The rule throughout: source lives in real files (`.ts`, `.tsx`, `.sql`). Bundles and manifests are build products — never hand-edited.

## Prerequisites

- A running Supabase-on-CockroachDB stack managed by the [supabase-kubernetes](https://github.com/supabase-community/supabase-kubernetes) operator, and its gateway URL and anon key.
- `node`/`npm`, `jq`, `make`, `docker` on the build machine, with push access to the registry the cluster pulls images from.
- `kubectl` access to the cluster.

## Build

```
make crs         # package the schema, semgrep-api and the semgrep Deployment into crs/semgrep.yaml
make image       # build the semgrep container image (Vite build + stage into generator/)
make all         # manifest and image
make clean       # remove build/, crs/ and the staged page
```

## Deploy

Environment-specific values (hostname, ports, keys) are configured on the cluster at deployment time; none of them live in this repository.

**1. Apply the manifest** — one file, three resources: the schema Migration, the `semgrep-api` Function, and the `semgrep` Deployment. The functions pod restarts on its own to pick up the Function; the Deployment ships at 0 replicas, so nothing runs yet.

```
kubectl apply -f crs/semgrep.yaml
```

**2. Build the image**, tagged for the registry the cluster pulls from (for example, an in-cluster registry at `localhost:5000`):

```
make image IMG=localhost:5000/semgrep:latest
```

**3. Push it:**

```
docker push localhost:5000/semgrep:latest
```

**4. Set the browser-reachable gateway URL** on the Deployment:

```
kubectl set env deployment/semgrep SEMGREP_EXTERNAL_URL=http://<hostname>:9000
```

**5. Set the public port** (your choice — for example 9001, beside the gateway's 9000):

```
kubectl patch deployment semgrep -p '{"spec":{"template":{"spec":{"containers":[{"name":"semgrep","ports":[{"containerPort":8080,"hostPort":9001}]}]}}}}'
```

**6. Bring it up:**

```
kubectl scale deployment semgrep --replicas=1
```

**7. Open the chosen port for public traffic.** On EC2: an inbound rule for TCP 9001 in the instance's security group.

**8. Open the app** at `http://<hostname>:9001/`.

**9. Allow the app's URL as an auth redirect target.** Signup sends the app's own URL as the confirmation redirect, and the auth service only honors redirect URLs on its allow-list. Add `http://<hostname>:9001/**` (the `/**` glob is required) to the auth service's `GOTRUE_URI_ALLOW_LIST` — a platform-side setting. The platform's `siteUrl` stays untouched: it is the instance-wide default shared by every app on the same Supabase instance.

## Usage

The left pane shows the newest messages that fit on screen, updating every couple of seconds — new messages appear at the top and old ones fall off. Type into the input at the bottom and press Enter to add a message; it is embedded and stored in the same request.

The right pane is search: type plain text and press Enter. Results are the stored messages ranked by vector distance to your query, closest first, with the distance shown. An empty query shows nothing.

## Architecture

### The container

The `semgrep` image is `python:3.12-slim` with nginx added from the Debian package repository. Two processes run in the container:

- **nginx**, in the foreground, serving the page.
- **`semgrep-generator`**, the message-generator loop.

The entrypoint starts both in the background and waits with `wait -n`. The moment either process exits, the entrypoint kills the other and exits nonzero — the container dies as a whole, and Kubernetes restarts it.

### Page configuration

The page runs in the browser, and the browser cannot read the container's environment. So the two values the page needs — the platform's anon key, and the external URL of the API gateway — are baked into the HTML before it is served. That happens in three stages:

1. **In the source.** `ui/src/client.ts` carries two placeholder string literals, one for the anon key and one for the gateway URL. The Vite build copies these literals verbatim into the single-file bundle, so the built HTML contains both placeholder strings. The build knows nothing about any real key or URL.

2. **At container start.** The entrypoint replaces both placeholders in the HTML with the values of two environment variables (a one-time `sed`), then starts nginx. The substitution happens once because the environment is fixed for the lifetime of the pod.

3. **At serve time.** nginx serves the finished static file. Nothing is computed per request.

The environment variables are set on the Deployment. The container's complete environment:

| Variable | Consumer | Source |
|---|---|---|
| `SEMGREP_URL` | generator loop | literal — in-cluster gateway URL |
| `SUPABASE_SERVICE_ROLE_KEY` | generator loop | secret `supabase-jwt`, key `service-key` |
| `SUPABASE_ANON_KEY` | page (via substitution) | secret `supabase-jwt`, key `anon-key` |
| `SEMGREP_EXTERNAL_URL` | page (via substitution) | set on the cluster with kubectl at deployment time |

The public port and the external URL appear nowhere in this repository's artifacts. The Deployment ships in `crs/semgrep.yaml` at 0 replicas; it is configured (URL, port) and scaled up on the cluster at deployment time, per the Deploy section.

### Cross-origin calls and HTTPS

The page is served from its own port, so every API call it makes is cross-origin — for example, page origin `host:9001`, APIs at `host:9000`. The envoy gateway answers the CORS preflights for all three path families the page uses — `/rest/v1` (the feed), `/functions/v1` (add, search, stats), and `/auth/v1` (login and signup) — echoing the requesting origin and allowing the requested headers. The page therefore calls the gateway directly; there is no proxy and no CORS configuration anywhere in this repository.

One rule follows from this setup: browsers block plain-HTTP requests made from an HTTPS page (mixed content). If the page is ever served over HTTPS, the injected gateway URL must switch to HTTPS at the same time. Both are deployment-time values, so this is an operational rule for whoever deploys — not a code change.

### Realtime

The platform's realtime service lets pages push messages to each other and see who's online, over a WebSocket through the same gateway the page already uses. Two things it does **not** do on this stack: it cannot stream database changes (`postgres_changes` is unavailable), and it keeps no history — a message sent while a client is disconnected is simply missed.

Everything goes through the `supabase` client the page already has (`ui/src/client.ts`). A channel is a named room: listen for events, subscribe, send.

```ts
import { supabase } from './client'

const channel = supabase.channel('room-1')

channel
  .on('broadcast', { event: 'new-message' }, ({ payload }) => {
    console.log(payload)
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      // connected (or reconnected) — re-fetch the feed here
    }
  })

channel.send({ type: 'broadcast', event: 'new-message', payload: { body: 'hi' } })
```

Presence answers "who's here right now". Announce yourself and read the room:

```ts
channel.on('presence', { event: 'sync' }, () => console.log(channel.presenceState()))
// after SUBSCRIBED:
channel.track({ name: 'alice' })
```

By default any channel is public. To restrict one, join with `supabase.channel('room-1', { config: { private: true } })` — then the sender's database role must pass an RLS policy on `realtime.messages`:

```sql
CREATE POLICY room1_broadcast ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (realtime.topic() = 'room-1' AND extension = 'broadcast');
```

The one gotcha: without a matching policy, sending to a private channel looks successful but nobody receives anything.

#### Connection mechanics

The client manages the socket itself. Every 25 seconds it sends a heartbeat frame and the server must answer; one missed reply and the client declares the connection dead, tears it down, and reconnects on its own with a 1 s / 2 s / 5 s / 10 s backoff. Connection health is observable without touching any of this:

```ts
supabase.realtime.onHeartbeat((status, latency) => {
  // status: 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected'
})
```

One browser caveat: hidden tabs get their timers throttled, so heartbeats can stop and the connection drops — and the client waits until the tab is visible again before reconnecting. If the connection must survive in a background tab, create the client with `{ realtime: { worker: true } }` to run the heartbeat in a Web Worker instead.

The `subscribe` status callback is where the app sees all of this:

| Status | Fires when | What to do |
|---|---|---|
| `SUBSCRIBED` | joined, or rejoined after an outage | re-fetch missed data |
| `CHANNEL_ERROR` | join rejected, socket error, heartbeat timeout, or connection lost | show degraded state; the client is already reconnecting |
| `TIMED_OUT` | the join itself got no reply within 10 s | same as `CHANNEL_ERROR` |
| `CLOSED` | the channel was closed | resubscribe if it wasn't intentional |

States can flap in quick succession during network jitter (`CHANNEL_ERROR` → `CLOSED` → `SUBSCRIBED` within a second or two), so react to the state you end up in, not to every transition.

Under the hood the transport is the Phoenix channel protocol — `phx_join` to subscribe, `phx_reply` for answers, `phx_error`/`phx_close` for failures. The client handles all of it; it's listed here for reading gateway and server logs, not for the app to implement. One server behavior worth knowing: join rejections are deliberately delayed server-side, so don't wrap `subscribe()` in a tight retry loop.

Your only job is in the status callback: `CHANNEL_ERROR` or `CLOSED` means you are currently missing messages, and when `SUBSCRIBED` fires again you re-fetch from the REST API (for this app, the feed's `/rest/v1/messages` query), because realtime never replays what you missed. REST stays the source of truth; realtime only tells you when to look.
