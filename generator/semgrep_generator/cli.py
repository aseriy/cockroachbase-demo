import logging
import warnings

import click
from pandas.errors import Pandas4Warning

from .operations import run_extract, run_index, run_messages, run_news, run_quotes, run_ticker, run_ticker_logo, run_ticker_news


@click.group()
def cli() -> None:
    pass


@cli.command(short_help="Feed generated messages to the semgrep board")
def messages() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_messages({})


@cli.command(short_help="Feed price bars to the quotes table")
def quotes() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    warnings.filterwarnings("ignore", category=Pandas4Warning)
    run_quotes({})


@cli.command(short_help="Fill missing ticker details from Yahoo")
def ticker() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_ticker({})


@cli.command(short_help="Log Yahoo news for active tickers")
def news() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_news({})


@cli.command(short_help="Extract Yahoo news articles to the yahoo-news bucket")
def extract() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_extract({})


@cli.command(short_help="Index extracted Yahoo news articles into the yahoo_news table")
def index() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_index({})


@cli.command(short_help="Link Yahoo news to tickers in the ticker_news table")
def ticker_news() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_ticker_news({})


@cli.command(short_help="Fill ticker logos from Elbstream")
def ticker_logo() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_ticker_logo({})


if __name__ == "__main__":
    cli()
