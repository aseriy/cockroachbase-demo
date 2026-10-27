import logging
import time

import yfinance as yf
from supabase import Client

from .common import get_client

logger = logging.getLogger(__name__)

NEWS_COUNT = 50
PAUSE_SECONDS = 60 * 15


def _active_symbols(client: Client) -> list[str]:
    rows = client.table("ticker").select("symbol").eq("active", True).execute().data
    return [row["symbol"] for row in rows]


def _search_news(symbol: str) -> list[dict]:
    return yf.Search(symbol, news_count=NEWS_COUNT).news


def _log_news(client: Client, items: list[dict]) -> None:
    if items:
        client.table("yahoo_news").upsert([{"id": item["uuid"], "publication": item} for item in items], on_conflict="id", ignore_duplicates=True).execute()


def run_news(args: dict) -> None:
    client = get_client()

    while True:
        try:
            symbols = _active_symbols(client)
            logger.info(f"active tickers: {len(symbols)}")

            for symbol in symbols:
                try:
                    items = _search_news(symbol)
                    _log_news(client, items)
                    logger.info(f"{symbol}: {len(items)} publications")
                except Exception as error:
                    logger.error(f"{symbol}: {error}")
        except Exception as error:
            logger.error(f"active tickers: {error}")

        time.sleep(PAUSE_SECONDS)
