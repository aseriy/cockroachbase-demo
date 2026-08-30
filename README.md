# semgrep

A demo application for self-hosted [Supabase](https://supabase.com) running on [CockroachDB](https://www.cockroachlabs.com). Messages typed into a web page are embedded by the `gte-small` model running inside the platform's edge runtime, stored in a native `VECTOR(384)` column, and searched by vector distance directly in the database.

No external AI service is involved: the embedding model runs in the edge runtime, the vectors live in CockroachDB, and the platform serves its own UI. The entire application deploys as one manifest file.

## How it works

- **`semgrep`** — an edge function that serves the web page. The page comes from the same origin as every API it calls, so there is no CORS configuration anywhere.
- **`semgrep-api`** — an edge function with two operations. Add: embed the message with `Supabase.ai.Session('gte-small')` and insert the row with text and vector together. Search: embed the query text the same way and return rows ranked by cosine distance, via the `search_messages` SQL function.
- **Schema** — one `messages` table with a `VECTOR(384)` column, plus the `search_messages` function, both owned by the platform's conventions and readable/callable by the API roles.
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
  semgrep/index.ts    SOURCE — two-line stub serving the built page
  semgrep-api/index.ts SOURCE — the add/search function
schema/
  schema.sql          SOURCE — table, search function, grants
build/                GENERATED — bundle, page module, manifest parts (gitignored)
crs/                  GENERATED — the single deployable manifest (gitignored)
```

The rule throughout: source lives in real files (`.ts`, `.tsx`, `.sql`). Bundles and manifests are build products — never hand-edited.

## Prerequisites

- A running Supabase-on-CockroachDB stack managed by the [supabase-kubernetes](https://github.com/supabase-community/supabase-kubernetes) operator, and its gateway URL and anon key.
- `node`/`npm`, `jq`, `make` on the build machine.
- `kubectl` access to the cluster.

## Build

```
make ui      # Vite build: ui/ → build/ui/index.html → build/semgrep/page.ts
make crs     # package everything into the single crs/semgrep.yaml
make all     # both
make clean   # remove build/ and crs/
```

## Deploy

```
kubectl apply -f crs/semgrep.yaml
```

One file, three resources: the schema Migration and the two Functions. The functions pod restarts on its own to pick them up. Then open:

```
http://<gateway-host>:<port>/functions/v1/semgrep
```

## Usage

The left pane shows the newest messages that fit on screen, updating every couple of seconds — new messages appear at the top and old ones fall off. Type into the input at the bottom and press Enter to add a message; it is embedded and stored in the same request.

The right pane is search: type plain text and press Enter. Results are the stored messages ranked by vector distance to your query, closest first, with the distance shown. An empty query shows nothing.

## Redeployment: the app moves out of the edge function

Disposition recorded 2026-08-30. The built page outgrew the Kubernetes CR size limit, so the app leaves the edge-function delivery path. This section records what is settled; implementation follows separately.

- **Objective** — the web app no longer ships as the `semgrep` Function CR and is no longer packaged into `crs/semgrep.yaml`. The `semgrep-api` function and the schema Migration are unaffected.
- **Image** — one Docker image named `semgrep` (replacing `semgrep-generator`), based on the existing `python:3.12-slim` generator image, running two processes: a static web server for the page and the `semgrep-generator` loop. An entrypoint backgrounds both, waits with `wait -n`, and kills the survivor when either exits — so either process dying kills the container and Kubernetes restarts it (the cockroachdb-omnibox pattern).
- **Serving duties** — the web server takes over what `functions/semgrep/index.ts` does today: serve the single-file bundle produced by `make ui` and substitute `__SUPABASE_ANON_KEY__` at serve time. It is a static server, not the Vite dev server.
- **Topology** — the container deploys into the same cluster and gets its own URL: the same hostname as the gateway, on its own public port (e.g. 9001 beside the gateway's 9000). The port is never hardcoded in packaged artifacts; it is configured manually at deployment time, with the steps to be documented here step by step.
- **CORS: settled** — live probes against the envoy gateway showed preflights answered with 200, the `:9001` origin echoed in `access-control-allow-origin`, and the requested headers allowed, on all three path families the page calls (`/rest/v1`, `/functions/v1`, `/auth/v1`). The page can call the gateway cross-origin directly; no proxy and no CORS code in this repo.
- **Open items** — the runtime injection mechanism for the API base URL (only `__SUPABASE_ANON_KEY__` has a placeholder today); the web-server implementation choice; where the Deployment manifest lives and the exposure mechanism for the public port; the container's final environment set; cleanup of the retired edge-function path; and a cosmetic `siteUrl` mismatch (signup confirmation emails land on the gateway port, not the app's).
