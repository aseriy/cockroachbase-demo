import asyncio
import logging

from realtime import RealtimeSubscribeStates
from supabase import AsyncClient
from yfinance._http import HTTPError
from yfinance.config import YfConfig

from .common import get_async_client
from .extract import _cutoff
from .ticker import _fetch_info

logger = logging.getLogger(__name__)

CHANNEL = "yahoo_news"
CONNECTION_CHECK_SECONDS = 30
CONNECTION_FAILED_CHECKS = 3
RESTART_SECONDS = 5
BACKFILL_ROWS = 1000

YfConfig.debug.hide_exceptions = False


async def _rows(client: AsyncClient, cutoff: str) -> list[dict]:
    return (await client.table("yahoo_news").select("id, publication, ticker_news()").is_("ticker_news", "null").lte("crdb_internal_mvcc_timestamp", cutoff).limit(BACKFILL_ROWS).execute()).data


async def _ticker_exists(client: AsyncClient, symbol: str) -> bool:
    return bool((await client.table("ticker").select("symbol").eq("symbol", symbol).execute()).data)


async def _exchange_exists(client: AsyncClient, code: str) -> bool:
    return bool((await client.table("exchange").select("code").eq("code", code).execute()).data)


async def _unresolved(client: AsyncClient, symbol: str) -> bool:
    return bool((await client.table("ticker_unresolved").select("symbol").eq("symbol", symbol).execute()).data)


async def _insert_exchange(client: AsyncClient, info: dict) -> None:
    await client.table("exchange").insert({"code": info["exchange"], "name": info["fullExchangeName"], "tz": info["exchangeTimezoneName"]}).execute()


async def _insert_ticker(client: AsyncClient, symbol: str, info: dict) -> None:
    await client.table("ticker").insert({"symbol": symbol, "exchange": info["exchange"], "name": info.get("longName", info.get("shortName")), "info": info}).execute()


async def _insert_unresolved(client: AsyncClient, symbol: str) -> None:
    await client.table("ticker_unresolved").insert({"symbol": symbol}).execute()


async def _ensure_ticker(client: AsyncClient, symbol: str) -> bool:
    if await _ticker_exists(client, symbol):
        return True

    if await _unresolved(client, symbol):
        return False

    try:
        info = await asyncio.to_thread(_fetch_info, symbol)
    except HTTPError as error:
        if error.response.status_code != 404:
            raise
        info = {}

    if "exchange" not in info:
        await _insert_unresolved(client, symbol)
        logger.info(f"{symbol}: unresolved")
        return False

    if not await _exchange_exists(client, info["exchange"]):
        await _insert_exchange(client, info)

    await _insert_ticker(client, symbol, info)
    return True


async def _upsert_ticker_news(client: AsyncClient, id: str, symbols: list[str]) -> None:
    rows = [{"news_id": id, "symbol": symbol} for symbol in symbols] if symbols else [{"news_id": id, "symbol": None}]
    await client.table("ticker_news").upsert(rows, on_conflict="news_id,symbol", ignore_duplicates=True).execute()


async def _process(client: AsyncClient, lock: asyncio.Lock, record: dict) -> None:
    async with lock:
        try:
            id = record["id"]
            symbols = record["publication"].get("relatedTickers") or []
            resolved = []
            for symbol in symbols:
                if await _ensure_ticker(client, symbol):
                    resolved.append(symbol)
            await _upsert_ticker_news(client, id, resolved)
            logger.info(f"{id}: {len(resolved)} tickers")
        except Exception as error:
            logger.error(f"{record.get('id')}: {error}")


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
            await _process(client, lock, row)


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


def run_ticker_news(args: dict) -> None:
    asyncio.run(_main())
