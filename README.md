# semgrep

A demo application for self-hosted [Supabase](https://supabase.com) running on [CockroachDB](https://www.cockroachlabs.com). Messages typed into a web page are embedded by the `gte-small` model running inside the platform's edge runtime, stored in a native `VECTOR(384)` column, and searched by vector distance directly in the database.

No external AI service is involved: the embedding model runs in the edge runtime, the vectors live in CockroachDB, and the page ships in the same container as the message generator. The application deploys as one manifest file plus one container image.

## How it works

- **`semgrep`** — the application container. nginx serves the web page (the anon key and the gateway URL are baked into it at container start), and the message-generator loop runs beside it, POSTing generated messages to the same API the page uses to keep the feed moving. The page calls the platform's APIs cross-origin; the envoy gateway answers the CORS preflights, so there is no CORS configuration in this repository.
- **`semgrep-api`** — an edge function with two operations. Add: embed the message with `Supabase.ai.Session('gte-small')` and insert the row with text and vector together. Search: embed the query text the same way and return rows ranked by cosine distance, via the `search_messages` SQL function.
- **Schema** — one `messages` table with a `VECTOR(384)` column, plus the `search_messages` function, both owned by the platform's conventions and readable/callable by the API roles.

The page:

```
┌──────────────────────────────┬───────────────────────────────┐
│  messages (live feed)        │  search                       │
│                              │  [ query………………… ]  ⏎          │
│  newest message              │                               │
│  older message               │  0.213  closest match         │
│  older message               │  0.487  next match            │
│  (newest on top, polls ~2s)  │  (ranked, distance shown)     │
├──────────────────────────────┤                               │
│  > type a message… ⏎         │                               │
└──────────────────────────────┴───────────────────────────────┘
```

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
make ui          # Vite build: ui/ → build/ui/index.html
make crs         # package the schema and semgrep-api into crs/semgrep.yaml
make image       # build the semgrep container image (stages the page into generator/)
make deployment  # generate the Deployment manifest (needs SEMGREP_PORT and SEMGREP_EXTERNAL_URL)
make all         # same as make crs
make clean       # remove build/, crs/ and the staged page
```

## Deploy

One step at a time; every value that names your environment enters on the command line, never from a file in this repository.

**1. Apply the manifest** — two resources: the schema Migration and the `semgrep-api` Function. The functions pod restarts on its own to pick them up.

```
kubectl apply -f crs/semgrep.yaml
```

**2. Build the image:**

```
make image
```

**3. Tag it for the registry the cluster pulls from** (the working example is the in-cluster registry at `localhost:5000`):

```
docker tag semgrep:latest localhost:5000/semgrep:latest
```

**4. Push it:**

```
docker push localhost:5000/semgrep:latest
```

**5. Generate the Deployment manifest.** Pick the public port for the app and pass the browser-reachable gateway URL — these two values exist only on your command line:

```
make deployment SEMGREP_PORT=9001 SEMGREP_EXTERNAL_URL=http://<hostname>:9000
```

**6. Apply it:**

```
kubectl apply -f build/manifests/semgrep.json
```

**7. Open the chosen port for public traffic.** On EC2: an inbound rule for TCP 9001 in the instance's security group.

**8. Open the app** at `http://<hostname>:9001/`.

**9. If upgrading from the edge-function delivery**, remove the retired pieces: the old page Function from the cluster —

```
kubectl delete function supabase-semgrep-function -n default --ignore-not-found
```

**10. Point the platform's `siteUrl` at the app** on the next project helm upgrade (`--set auth.siteUrl=http://<hostname>:9001`), so signup-confirmation emails land on the app instead of the gateway port.

## Usage

The left pane shows the newest messages that fit on screen, updating every couple of seconds — new messages appear at the top and old ones fall off. Type into the input at the bottom and press Enter to add a message; it is embedded and stored in the same request.

The right pane is search: type plain text and press Enter. Results are the stored messages ranked by vector distance to your query, closest first, with the distance shown. An empty query shows nothing.

## Redeployment: the app moves out of the edge function

Disposition recorded 2026-08-30, decisions completed 2026-08-31. This section documents where the application is going and why; the implementation, and the step-by-step deployment instructions that come with it, follow separately.

### Why the app is moving

Today the web page reaches the cluster embedded inside a Kubernetes resource: `make crs` takes the Vite-built page, wraps it JSON-escaped into the `semgrep` Function CR, and packages that into `crs/semgrep.yaml`. The built page has outgrown the Kubernetes CR size limit, so this delivery path no longer works — the manifest cannot be applied once the embedded page pushes it over the limit.

Only the page delivery changes. The `semgrep-api` edge function and the schema Migration are unaffected: they remain in `crs/semgrep.yaml` and deploy exactly as before.

### The new shape

The page moves into a Docker image named `semgrep`, which replaces the current `semgrep-generator` image. It is built on the same `python:3.12-slim` base the generator uses today, with nginx added from the Debian package repository.

Two processes run in the container:

- **nginx**, in the foreground, serving the page.
- **`semgrep-generator`**, the existing message-generator loop, unchanged.

The container's entrypoint starts both in the background and then waits with `wait -n`. The moment either process exits, the entrypoint kills the other and exits nonzero — the container dies as a whole, and Kubernetes restarts it. This is the same supervision pattern used by the cockroachdb-omnibox entrypoint, where CockroachDB and an embedded workload share one container.

### How the page gets its configuration

The page runs in the browser, and the browser cannot read the container's environment. So the two values the page needs — the platform's anon key, and the external URL of the API gateway — have to be baked into the HTML before it is served. That happens in three stages:

1. **In the source.** `ui/src/client.ts` carries placeholder string literals: the existing `__SUPABASE_ANON_KEY__`, plus a new placeholder for the gateway URL. The Vite build (`make ui`) copies these literals verbatim into the single-file bundle, so the built HTML contains both placeholder strings. The build knows nothing about any real key or URL.

2. **At container start.** The entrypoint replaces both placeholders in the HTML with the values of two environment variables (a one-time `sed`), then starts nginx. The substitution happens once because the environment is fixed for the lifetime of the pod. This replaces the per-request `replaceAll` that the `functions/semgrep/index.ts` edge function performs today.

3. **At serve time.** nginx serves the finished static file. Nothing is computed per request.

The environment variables reach the container exactly the way the generator's do today — set on the Deployment at deployment time. The generator already reads `SEMGREP_URL` (a literal value in the manifest) and `SUPABASE_SERVICE_ROLE_KEY` (a `secretKeyRef` into the platform's `supabase-jwt` secret). The page's two values ride the same mechanism: the anon key comes from the same `supabase-jwt` secret (its `anon-key` entry, beside the `service-key` the generator uses), and the external gateway URL is a literal value chosen at deployment time. The container's complete environment is therefore:

| Variable | Consumer | Source |
|---|---|---|
| `SEMGREP_URL` | generator loop | literal — in-cluster gateway URL |
| `SUPABASE_SERVICE_ROLE_KEY` | generator loop | secret `supabase-jwt`, key `service-key` |
| anon key | page (via substitution) | secret `supabase-jwt`, key `anon-key` |
| external gateway URL | page (via substitution) | literal — browser-reachable URL, set at deployment |

### Where it runs

The container deploys into the same Kubernetes cluster as the platform and gets its own URL: the same hostname as the gateway, on its own public port. The working example is port 9001, beside the gateway's 9000. The port appears nowhere in this repository's packaged artifacts — it is chosen at deployment time, passed to `make deployment` on the command line; the steps are documented in the Deploy section above.

With the app out of the packaging, `crs/semgrep.yaml` shrinks to two resources — the schema Migration and the `semgrep-api` Function — and the generator's Deployment manifest leaves the packaging along with the app, since the generator now lives in the app's container.

### Cross-origin calls and HTTPS

Serving the page from its own port means every API call it makes is cross-origin: the page's origin is `host:9001`, the APIs are at `host:9000`. This was probed live against the envoy gateway before being accepted: for all three path families the page uses — `/rest/v1` (the feed), `/functions/v1` (add, search, stats), and `/auth/v1` (login and signup) — envoy answers CORS preflights with 200, echoes the requesting origin in `access-control-allow-origin`, and allows the requested headers. The page therefore calls the gateway directly; there is no proxy and no CORS configuration anywhere in this repository.

One production rule follows from this setup: browsers block plain-HTTP requests made from an HTTPS page (mixed content). If the page is ever served over HTTPS, the injected gateway URL must switch to HTTPS at the same time. Both are deployment-time values, so this is an operational rule for whoever deploys — not a code change.

### Loose ends that are work, not questions

The repository side of this move is implemented: the edge-function delivery path is retired, and the packaging produces the two-resource manifest plus the generated Deployment manifest. Two operational steps remain on the cluster, both covered in the Deploy section above: deleting the deployed `supabase-semgrep-function` Function CR, and moving the platform's `siteUrl` to the app's URL at the next helm upgrade.
