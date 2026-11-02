import asyncio
import logging
from urllib.parse import quote

import requests
from realtime import RealtimeSubscribeStates
from supabase import AsyncClient

from .common import get_async_client

logger = logging.getLogger(__name__)

CHANNEL = "ticker"
CONNECTION_CHECK_SECONDS = 30
CONNECTION_FAILED_CHECKS = 3
RESTART_SECONDS = 5
LOGO_URL = "https://api.elbstream.com/logos/symbol/"
NO_LOGO = "-"


async def _tickers_missing_logo(client: AsyncClient) -> list[str]:
    rows = (await client.table("ticker").select("symbol").is_("logo", "null").execute()).data
    return [row["symbol"] for row in rows]


def _fetch_logo(symbol: str) -> str:
    response = requests.get(LOGO_URL + quote(symbol, safe=""), params={"format": "svg"}, timeout=10)
    if response.status_code == 200:
        return response.text if response.headers["Content-Type"].startswith("image/svg+xml") else NO_LOGO
    if response.status_code == 404:
        return NO_LOGO
    raise RuntimeError(f"logo {response.status_code}")


async def _update_ticker(client: AsyncClient, symbol: str, logo: str) -> None:
    await client.table("ticker").update({"logo": logo}).eq("symbol", symbol).execute()


async def _fill(client: AsyncClient, lock: asyncio.Lock, symbol: str) -> None:
    async with lock:
        try:
            logo = await asyncio.to_thread(_fetch_logo, symbol)
            await _update_ticker(client, symbol, logo)
            logger.info(f"{symbol}: {'no logo' if logo == NO_LOGO else 'logo'}")
        except Exception as error:
            logger.error(f"{symbol}: {error}")


async def _backfill(client: AsyncClient, lock: asyncio.Lock) -> None:
    try:
        symbols = await _tickers_missing_logo(client)
    except Exception as error:
        logger.error(f"tickers missing logo: {error}")
        symbols = []

    logger.info(f"tickers missing logo: {len(symbols)}")

    for symbol in symbols:
        await _fill(client, lock, symbol)


async def _serve(client: AsyncClient) -> None:
    lock = asyncio.Lock()
    failed = asyncio.Event()

    def on_insert(payload: dict) -> None:
        record = payload["data"]["record"]
        symbol = record["symbol"]
        logger.info(f"{symbol}: inserted")
        if record["logo"] is None:
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


def run_ticker_logo(args: dict) -> None:
    asyncio.run(_main())
