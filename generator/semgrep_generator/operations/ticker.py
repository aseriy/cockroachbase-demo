import asyncio
import logging

import yfinance as yf
from realtime import RealtimeSubscribeStates
from supabase import AsyncClient

from .common import get_async_client

logger = logging.getLogger(__name__)

CHANNEL = "ticker"
CONNECTION_CHECK_SECONDS = 30
CONNECTION_FAILED_CHECKS = 3
RESTART_SECONDS = 5
BACKFILL_ROWS = 1000
PROCESS_ATTEMPTS = 3


async def _cutoff(client: AsyncClient) -> str:
    return (await client.rpc("ticker_latest_mvcc_timestamp").execute()).data


async def _rows(client: AsyncClient, cutoff: str) -> list[str]:
    rows = (await client.table("ticker").select("symbol").is_("info", "null").lte("crdb_internal_mvcc_timestamp", cutoff).limit(BACKFILL_ROWS).execute()).data
    return [row["symbol"] for row in rows]


def _fetch_info(symbol: str) -> dict:
    return yf.Ticker(symbol).info


async def _update_ticker(client: AsyncClient, symbol: str, info: dict) -> None:
    await client.table("ticker").update({"exchange": info["exchange"], "name": info.get("longName", info.get("shortName")), "info": info}).eq("symbol", symbol).execute()


async def _fill(client: AsyncClient, lock: asyncio.Lock, symbol: str) -> bool:
    async with lock:
        try:
            info = await asyncio.to_thread(_fetch_info, symbol)
            await _update_ticker(client, symbol, info)
            logger.info(f"{symbol}: {info['exchange']} {info.get('longName', info.get('shortName'))}")
            return True
        except Exception as error:
            logger.error(f"{symbol}: {error}")
            return False


async def _backfill(client: AsyncClient, lock: asyncio.Lock) -> None:
    try:
        cutoff = await _cutoff(client)
    except Exception as error:
        logger.error(f"ticker: {error}")
        return

    while True:
        try:
            symbols = await _rows(client, cutoff)
        except Exception as error:
            logger.error(f"ticker: {error}")
            return

        if not symbols:
            return

        logger.info(f"tickers missing info: {len(symbols)}")

        for symbol in symbols:
            for attempt in range(PROCESS_ATTEMPTS):
                if await _fill(client, lock, symbol):
                    break
                await asyncio.sleep(attempt + 1)


async def _serve(client: AsyncClient) -> None:
    lock = asyncio.Lock()
    failed = asyncio.Event()

    def on_insert(payload: dict) -> None:
        record = payload["data"]["record"]
        symbol = record["symbol"]
        logger.info(f"{symbol}: inserted")
        if record["info"] is None:
            asyncio.create_task(_fill(client, lock, symbol))

    def on_status(status: RealtimeSubscribeStates, error) -> None:
        if status == RealtimeSubscribeStates.SUBSCRIBED:
            logger.info(f"{CHANNEL}: subscribed")
            asyncio.create_task(_backfill(client, lock))
        else:
            logger.error(f"{CHANNEL}: {status} {error}")
            failed.set()

    channel = client.channel(CHANNEL)
    channel.on_postgres_changes("INSERT", schema="public", table="ticker", callback=on_insert)
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


def run_ticker(args: dict) -> None:
    asyncio.run(_main())
