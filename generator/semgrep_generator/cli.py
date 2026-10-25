import logging

import click

from .operations import run_messages, run_quotes, run_ticker


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


if __name__ == "__main__":
    cli()
