import logging

import click

from .operations import run_extract, run_index, run_messages, run_news, run_quotes, run_ticker


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


if __name__ == "__main__":
    cli()
