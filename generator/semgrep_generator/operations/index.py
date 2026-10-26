import asyncio
import logging

from llama_index.core import Document, VectorStoreIndex
from llama_index.core.node_parser import MarkdownNodeParser
from realtime import RealtimeSubscribeStates
from supabase import AsyncClient

from .common import get_async_client

logger = logging.getLogger(__name__)

CHANNEL = "yahoo_news"
BUCKET = "yahoo-news"
CONNECTION_CHECK_SECONDS = 30
CONNECTION_FAILED_CHECKS = 3
RESTART_SECONDS = 5


def _index(id: str, text: str) -> dict:
    documents = [Document(text=text, metadata={"source": f"{id}.md"})]
    index = VectorStoreIndex.from_documents(documents, transformations=[MarkdownNodeParser()])
    return index.storage_context.to_dict()


async def _download(client: AsyncClient, id: str) -> str:
    return (await client.storage.from_(BUCKET).download(f"{id}.md")).decode("utf-8")


async def _update_yahoo_news(client: AsyncClient, id: str, llama_index: dict) -> None:
    await client.table("yahoo_news").update({"llama_index": llama_index}).eq("id", id).execute()


async def _process(client: AsyncClient, lock: asyncio.Lock, row: dict) -> None:
    async with lock:
        try:
            id = row["id"]
            text = await _download(client, id)
            llama_index = await asyncio.to_thread(_index, id, text)
            await _update_yahoo_news(client, id, llama_index)
            logger.info(f"{id}: indexed")
        except Exception as error:
            logger.error(f"{row.get('id')}: {error}")


async def _serve(client: AsyncClient) -> None:
    lock = asyncio.Lock()
    failed = asyncio.Event()

    def on_update(payload: dict) -> None:
        record = payload["data"]["record"]
        if record.get("extracted") and record.get("llama_index") is None:
            logger.info(f"{record.get('id')}: extracted")
            asyncio.create_task(_process(client, lock, record))

    def on_status(status: RealtimeSubscribeStates, error) -> None:
        if status == RealtimeSubscribeStates.SUBSCRIBED:
            logger.info(f"{CHANNEL}: subscribed")
        else:
            logger.error(f"{CHANNEL}: {status} {error}")
            failed.set()

    channel = client.channel(CHANNEL)
    channel.on_postgres_changes("UPDATE", schema="public", table="yahoo_news", callback=on_update)
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


def run_index(args: dict) -> None:
    asyncio.run(_main())
