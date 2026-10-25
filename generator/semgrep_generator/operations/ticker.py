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


async def _tickers_missing_info(client: AsyncClient) -> list[str]:
    rows = (await client.table("ticker").select("symbol, exchange, name, info").execute()).data
    return [row["symbol"] for row in rows if row["exchange"] is None or row["name"] is None or row["info"] is None]


def _fetch_info(symbol: str) -> dict:
    return yf.Ticker(symbol).info


async def _update_ticker(client: AsyncClient, symbol: str, info: dict) -> None:
    await client.table("ticker").update({"exchange": info["exchange"], "name": info["longName"], "info": info}).eq("symbol", symbol).execute()


async def _fill(client: AsyncClient, lock: asyncio.Lock, symbol: str) -> None:
    async with lock:
        try:
            info = await asyncio.to_thread(_fetch_info, symbol)
            await _update_ticker(client, symbol, info)
            logger.info(f"{symbol}: {info['exchange']} {info['longName']}")
        except Exception as error:
            logger.error(f"{symbol}: {error}")


async def _backfill(client: AsyncClient, lock: asyncio.Lock) -> None:
    try:
        symbols = await _tickers_missing_info(client)
    except Exception as error:
        logger.error(f"tickers missing info: {error}")
        symbols = []

    logger.info(f"tickers missing info: {len(symbols)}")

    for symbol in symbols:
        await _fill(client, lock, symbol)


async def _serve(client: AsyncClient) -> None:
    lock = asyncio.Lock()
    failed = asyncio.Event()

    def on_insert(payload: dict) -> None:
        symbol = payload["data"]["record"]["symbol"]
        logger.info(f"{symbol}: inserted")
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
