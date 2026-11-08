import asyncio
import logging
from datetime import datetime, time, timedelta, timezone
from time import monotonic
from typing import Optional
from zoneinfo import ZoneInfo

import yfinance as yf
from realtime import RealtimeSubscribeStates
from supabase import AsyncClient
from yfinance.exceptions import YFPricesMissingError

from .common import get_async_client

logger = logging.getLogger(__name__)

CHANNEL = "ticker"
HISTORY_SECONDS = 691200 - 5
UPSERT_ROWS = 180
PASS_INTERVAL_SECONDS = 300
BACKFILL_ROWS = 1000


async def _exchanges(client: AsyncClient) -> dict:
    rows = (await client.table("exchange").select("code, open, close, tz").execute()).data
    return {row["code"]: row for row in rows}


async def _active_tickers(client: AsyncClient) -> list[dict]:
    tickers = []
    last = ""
    while True:
        rows = (await client.table("ticker").select("symbol, exchange").eq("active", True).gt("symbol", last).order("symbol").limit(BACKFILL_ROWS).execute()).data
        if not rows:
            return tickers
        tickers.extend(rows)
        last = rows[-1]["symbol"]


def _is_open(exchange: dict) -> bool:
    now = datetime.now(ZoneInfo(exchange["tz"])).time()
    return time.fromisoformat(exchange["open"]) <= now <= time.fromisoformat(exchange["close"])


async def _latest_ts(client: AsyncClient, symbol: str) -> Optional[datetime]:
    rows = (await client.table("ticker_price").select("ts").eq("symbol", symbol).order("ts", desc=True).limit(1).execute()).data
    return datetime.fromisoformat(rows[0]["ts"]) if rows else None


def _window_start(latest: Optional[datetime], end: datetime) -> datetime:
    floor = end - timedelta(seconds=HISTORY_SECONDS)
    return floor if latest is None or latest < floor else latest


def _fetch_bars(symbol: str, start: datetime, end: datetime):
    return yf.Ticker(symbol).history(start=start, end=end, interval="1m", prepost=True, actions=False, rounding=True).iloc[1:]


def _rows(symbol: str, bars) -> list[dict]:
    return [
        {
            "symbol": symbol,
            "ts": bar.Index.isoformat(),
            "open": float(bar.Open),
            "high": float(bar.High),
            "low": float(bar.Low),
            "close": float(bar.Close),
            "volume": int(bar.Volume),
        }
        for bar in bars.itertuples()
    ]


async def _upsert_bars(client: AsyncClient, rows: list[dict]) -> None:
    for i in range(0, len(rows), UPSERT_ROWS):
        await client.table("ticker_price").upsert(rows[i:i + UPSERT_ROWS], on_conflict="symbol,ts").execute()


async def _fill(client: AsyncClient, lock: asyncio.Lock, symbol: str) -> None:
    async with lock:
        try:
            end = datetime.now(timezone.utc) - timedelta(minutes=1)
            latest = await _latest_ts(client, symbol)
            start = _window_start(latest, end)
            bars = await asyncio.to_thread(_fetch_bars, symbol, start, end)
            rows = _rows(symbol, bars)
            await _upsert_bars(client, rows)
            if rows:
                logger.info(f"{symbol}: {len(rows)} bars")
        except YFPricesMissingError:
            pass
        except Exception as error:
            logger.error(f"{symbol}: {error}")


async def _run_pass(client: AsyncClient, lock: asyncio.Lock, first: bool) -> None:
    try:
        exchanges = await _exchanges(client)
    except Exception as error:
        logger.error(f"exchanges: {error}")
        exchanges = {}

    try:
        tickers = await _active_tickers(client)
    except Exception as error:
        logger.error(f"active tickers: {error}")
        tickers = []

    due = []
    for ticker in tickers:
        exchange = exchanges.get(ticker["exchange"])
        if exchange is None:
            logger.info(f"{ticker['symbol']}: skipped, no exchange")
        elif not first and not _is_open(exchange):
            logger.info(f"{ticker['symbol']}: skipped, closed")
        else:
            due.append(ticker["symbol"])

    logger.info(f"tickers due: {len(due)}")

    for symbol in due:
        await _fill(client, lock, symbol)


async def _subscribe(client: AsyncClient, lock: asyncio.Lock) -> None:
    logger.debug("debug: subscribe start")

    def on_insert(payload: dict) -> None:
        logger.debug(f"debug: payload {payload}")
        record = payload["data"]["record"]
        symbol = record["symbol"]
        logger.info(f"{symbol}: inserted")
        if record["active"]:
            asyncio.create_task(_fill(client, lock, symbol))

    def on_update(payload: dict) -> None:
        logger.debug(f"debug: payload {payload}")
        record = payload["data"]["record"]
        symbol = record["symbol"]
        logger.info(f"{symbol}: updated")
        if record["active"]:
            asyncio.create_task(_fill(client, lock, symbol))

    def on_status(status: RealtimeSubscribeStates, error) -> None:
        logger.debug(f"debug: status {status} {error}")
        if status == RealtimeSubscribeStates.SUBSCRIBED:
            logger.info(f"{CHANNEL}: subscribed")
        else:
            logger.error(f"{CHANNEL}: {status} {error}")

    try:
        channel = client.channel(CHANNEL)
        channel.on_postgres_changes("INSERT", schema="public", table="ticker", callback=on_insert)
        channel.on_postgres_changes("UPDATE", schema="public", table="ticker", callback=on_update)
        await channel.subscribe(on_status)
        logger.debug("debug: subscribe returned")
    except Exception as error:
        logger.error(f"{CHANNEL}: {error}")


async def _main() -> None:
    client = await get_async_client()
    lock = asyncio.Lock()
    subscription = asyncio.create_task(_subscribe(client, lock))
    logger.debug("debug: subscribe task created")
    first = True
    while True:
        started = monotonic()
        logger.debug("debug: pass start")
        await _run_pass(client, lock, first)
        logger.debug("debug: pass end")
        first = False
        await asyncio.sleep(max(0.0, PASS_INTERVAL_SECONDS - (monotonic() - started)))


def run_quotes(args: dict) -> None:
    asyncio.run(_main())
