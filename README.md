# Semantic Messages Demo

A demo application for self-hosted [Supabase](https://supabase.com) running on [CockroachDB](https://www.cockroachlabs.com). Messages typed into a web page are embedded by the `gte-small` model running inside the platform's edge runtime, stored in a native `VECTOR(384)` column, and searched by vector distance directly in the database.

No external AI service is involved: the embedding model runs in the edge runtime, the vectors live in CockroachDB, and the platform serves its own UI. The entire application deploys as three Kubernetes manifests.

## How it works

- **UI function** — an edge function serves the web page. The page comes from the same origin as every API it calls, so there is no CORS configuration anywhere.
- **Semantic function** — receives a message over POST, embeds it with `Supabase.ai.Session('gte-small')`, and inserts the row with text and vector together. Search takes plain query text, embeds it the same way, and returns rows ranked by cosine distance.
- **Schema** — one `messages` table with a `VECTOR(384)` column, owned by `postgres`, readable by the API roles over REST.
- **Message generator** (optional) — an external container that POSTs generated messages to the same endpoint the page uses, to keep the feed moving.

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
  semantic/index.ts   SOURCE — the message/search function
  demo-ui/index.ts    SOURCE — two-line stub serving the built page
schema/
  demo-schema.sql     SOURCE — table, ownership, grants
build/                GENERATED — the UI bundle and page module (gitignored)
crs/                  GENERATED — the deployment manifests
```

The rule throughout: source lives in real files (`.ts`, `.tsx`, `.sql`). Bundles and manifests are build products — never hand-edited.

## Prerequisites

- A running Supabase-on-CockroachDB stack managed by the [supabase-kubernetes](https://github.com/supabase-community/supabase-kubernetes) operator, and its gateway URL and anon key.
- `node`/`npm`, `jq`, `make` on the build machine.
- `kubectl` access to the cluster.

## Build

```
make ui      # Vite build: ui/ → build/ui/index.html → build/demo-ui/page.ts
make crs     # package sources and build output into crs/*.yaml
make all     # both
make clean   # remove build/ and crs/
```

## Deploy

```
kubectl apply -f crs/supabase-demo-schema-migration.yaml
kubectl apply -f crs/supabase-semantic-function.yaml
kubectl apply -f crs/supabase-demo-ui-function.yaml
```

The functions pod restarts on its own to pick up the new functions. Then open:

```
http://<gateway-host>:<port>/functions/v1/demo-ui
```

## Usage

The left pane shows the newest messages that fit on screen, updating every couple of seconds — new messages appear at the top and old ones fall off. Type into the input at the bottom and press Enter to add a message; it is embedded and stored in the same request.

The right pane is search: type plain text and press Enter. Results are the stored messages ranked by vector distance to your query, closest first, with the distance shown. An empty query shows nothing.
