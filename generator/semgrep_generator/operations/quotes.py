import logging
from datetime import datetime, time, timedelta, timezone
from time import monotonic, sleep
from typing import Optional
from zoneinfo import ZoneInfo

import yfinance as yf

from .common import client

logger = logging.getLogger(__name__)

HISTORY_SECONDS = 691200 - 5
UPSERT_ROWS = 180
PASS_INTERVAL_SECONDS = 300


def _tickers_missing_info() -> list[str]:
    rows = client.table("ticker").select("symbol, exchange, name, info").execute().data
    return [row["symbol"] for row in rows if row["exchange"] is None or row["name"] is None or row["info"] is None]


def _fetch_info(symbol: str) -> dict:
    return yf.Ticker(symbol).info


def _update_ticker(symbol: str, info: dict) -> None:
    client.table("ticker").update({"exchange": info["exchange"], "name": info["longName"], "info": info}).eq("symbol", symbol).execute()


def _exchanges() -> dict:
    rows = client.table("exchange").select("code, open, close, tz").execute().data
    return {row["code"]: row for row in rows}


def _active_tickers() -> list[dict]:
    return client.table("ticker").select("symbol, exchange").eq("active", True).execute().data


def _is_open(exchange: dict) -> bool:
    now = datetime.now(ZoneInfo(exchange["tz"])).time()
    return time.fromisoformat(exchange["open"]) <= now <= time.fromisoformat(exchange["close"])


def _latest_ts(symbol: str) -> Optional[datetime]:
    rows = client.table("ticker_price").select("ts").eq("symbol", symbol).order("ts", desc=True).limit(1).execute().data
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


def _upsert_bars(rows: list[dict]) -> None:
    for i in range(0, len(rows), UPSERT_ROWS):
        client.table("ticker_price").upsert(rows[i:i + UPSERT_ROWS], on_conflict="symbol,ts").execute()


def _run_pass() -> None:
    try:
        symbols = _tickers_missing_info()
    except Exception as error:
        logger.error(f"tickers missing info: {error}")
        symbols = []

    logger.info(f"tickers missing info: {len(symbols)}")

    for symbol in symbols:
        try:
            info = _fetch_info(symbol)
            _update_ticker(symbol, info)
            logger.info(f"{symbol}: {info['exchange']} {info['longName']}")
        except Exception as error:
            logger.error(f"{symbol}: {error}")

    try:
        exchanges = _exchanges()
    except Exception as error:
        logger.error(f"exchanges: {error}")
        exchanges = {}

    try:
        tickers = _active_tickers()
    except Exception as error:
        logger.error(f"active tickers: {error}")
        tickers = []

    due = []
    for ticker in tickers:
        exchange = exchanges.get(ticker["exchange"])
        if exchange is None:
            logger.info(f"{ticker['symbol']}: skipped, no exchange")
        elif not _is_open(exchange):
            logger.info(f"{ticker['symbol']}: skipped, closed")
        else:
            due.append(ticker["symbol"])

    logger.info(f"tickers due: {len(due)}")

    for symbol in due:
        try:
            end = datetime.now(timezone.utc) - timedelta(minutes=1)
            latest = _latest_ts(symbol)
            start = _window_start(latest, end)
            bars = _fetch_bars(symbol, start, end)
            rows = _rows(symbol, bars)
            _upsert_bars(rows)
            logger.info(f"{symbol}: {len(rows)} bars")
        except Exception as error:
            logger.error(f"{symbol}: {error}")


def run_quotes(args: dict) -> None:
    while True:
        started = monotonic()
        _run_pass()
        sleep(max(0.0, PASS_INTERVAL_SECONDS - (monotonic() - started)))
