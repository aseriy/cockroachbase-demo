import asyncio
import json
import logging

import trafilatura
import yaml
from realtime import RealtimeSubscribeStates
from supabase import AsyncClient

from .common import get_async_client

logger = logging.getLogger(__name__)

CHANNEL = "yahoo_news"
BUCKET = "yahoo-news"
CONNECTION_CHECK_SECONDS = 30
CONNECTION_FAILED_CHECKS = 3
RESTART_SECONDS = 5
BACKFILL_ROWS = 1000
PROCESS_ATTEMPTS = 3


def _is_heading(line: str) -> bool:
    """Identify short standalone section labels."""
    line = line.strip()
    words = line.split()

    return (
        2 <= len(words) <= 14
        and len(line) <= 100
        and not line.endswith((".", "!", "?", ":", ",", ";"))
        and not line.startswith(("#", "-", "*", ">"))
    )


def _extract(url: str) -> str:
    html = trafilatura.fetch_url(url)

    if not html:
        raise RuntimeError(f"Could not download: {url}")

    # Extract metadata.
    metadata_json = trafilatura.extract(
        html,
        url=url,
        output_format="json",
        with_metadata=True,
        include_comments=False,
    )

    metadata = json.loads(metadata_json) if metadata_json else {}

    # Remove article-body fields from the front matter.
    for field in (
        "text",
        "raw_text",
        "comments",
        "commentsbody",
        "body",
    ):
        metadata.pop(field, None)

    # Remove empty metadata values.
    metadata = {
        key: value
        for key, value in metadata.items()
        if value not in (None, "", [], {})
    }

    # Extract the article as Markdown.
    article = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        include_links=True,
        include_comments=False,
        include_tables=True,
        with_metadata=False,
    )

    if not article:
        raise RuntimeError("Article extraction failed")

    lines = article.splitlines()
    title = metadata.get("title", "").strip()
    title_added = False

    for index, line in enumerate(lines):
        stripped = line.strip()

        if not stripped:
            continue

        # Promote the article title to H1.
        if not title_added and (not title or stripped == title):
            lines[index] = f"# {stripped}"
            title_added = True
            continue

        # Promote likely section labels to H2.
        if _is_heading(stripped):
            previous_blank = index == 0 or not lines[index - 1].strip()
            next_blank = index == len(lines) - 1 or not lines[index + 1].strip()

            if previous_blank and next_blank:
                lines[index] = f"## {stripped}"

    front_matter = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        sort_keys=False,
    ).strip()

    return "---\n" + front_matter + "\n---\n\n" + "\n".join(lines) + "\n"


async def _cutoff(client: AsyncClient) -> str:
    return (await client.rpc("yahoo_news_latest_mvcc_timestamp").execute()).data


async def _rows(client: AsyncClient, cutoff: str) -> list[dict]:
    return (await client.table("yahoo_news").select("id, publication").eq("extracted", False).lte("crdb_internal_mvcc_timestamp", cutoff).limit(BACKFILL_ROWS).execute()).data


async def _upload(client: AsyncClient, id: str, text: str) -> None:
    await client.storage.from_(BUCKET).upload(f"{id}.md", text.encode("utf-8"), file_options={"content-type": "text/markdown", "upsert": "true"})


async def _update_yahoo_news(client: AsyncClient, id: str) -> None:
    await client.table("yahoo_news").update({"extracted": True}).eq("id", id).execute()


async def _process(client: AsyncClient, lock: asyncio.Lock, row: dict) -> bool:
    async with lock:
        try:
            id = row["id"]
            link = row["publication"]["link"]
            text = await asyncio.to_thread(_extract, link)
            await _upload(client, id, text)
            await _update_yahoo_news(client, id)
            logger.info(f"{id}: {link}")
            return True
        except Exception as error:
            logger.error(f"{row.get('id')}: {error}")
            return False


async def _backfill(client: AsyncClient, lock: asyncio.Lock) -> None:
    try:
        cutoff = await _cutoff(client)
    except Exception as error:
        logger.error(f"yahoo_news: {error}")
        return

    while True:
        try:
            rows = await _rows(client, cutoff)
        except Exception as error:
            logger.error(f"yahoo_news: {error}")
            return

        if not rows:
            return

        logger.info(f"publications: {len(rows)}")

        for row in rows:
            for attempt in range(PROCESS_ATTEMPTS):
                if await _process(client, lock, row):
                    break
                await asyncio.sleep(attempt + 1)


async def _serve(client: AsyncClient) -> None:
    lock = asyncio.Lock()
    failed = asyncio.Event()

    def on_insert(payload: dict) -> None:
        record = payload["data"]["record"]
        logger.info(f"{record.get('id')}: inserted")
        asyncio.create_task(_process(client, lock, record))

    def on_status(status: RealtimeSubscribeStates, error) -> None:
        if status == RealtimeSubscribeStates.SUBSCRIBED:
            logger.info(f"{CHANNEL}: subscribed")
            asyncio.create_task(_backfill(client, lock))
        else:
            logger.error(f"{CHANNEL}: {status} {error}")
            failed.set()

    channel = client.channel(CHANNEL)
    channel.on_postgres_changes("INSERT", schema="public", table="yahoo_news", callback=on_insert)
    await channel.subscribe(on_status)

    missed = 0
    while not failed.is_set():
        await asyncio.sleep(CONNECTION_CHECK_SECONDS)
        missed = 0 if client.realtime.is_connected else missed + 1
        if missed >= CONNECTION_FAILED_CHECKS:
            logger.error(f"{CHANNEL}: connection lost")
            return


async def _main() -> None:
    while True:
        client = await get_async_client()
        try:
            await _serve(client)
        except Exception as error:
            logger.error(f"{CHANNEL}: {error}")
        finally:
            await client.realtime.remove_all_channels()
        await asyncio.sleep(RESTART_SECONDS)


def run_extract(args: dict) -> None:
    asyncio.run(_main())
