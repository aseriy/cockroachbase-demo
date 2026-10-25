import logging

import yfinance as yf

from .common import client

logger = logging.getLogger(__name__)


def _tickers_missing_info() -> list[str]:
    rows = client.table("ticker").select("symbol, exchange, name, info").execute().data
    return [row["symbol"] for row in rows if row["exchange"] is None or row["name"] is None or row["info"] is None]


def _fetch_info(symbol: str) -> dict:
    return yf.Ticker(symbol).info


def _update_ticker(symbol: str, info: dict) -> None:
    client.table("ticker").update({"exchange": info["exchange"], "name": info["longName"], "info": info}).eq("symbol", symbol).execute()


def run_ticker(args: dict) -> None:
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
