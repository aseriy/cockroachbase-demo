import importlib
import logging
import os
import pkgutil
import random
import time
from typing import Optional

import click
from supabase import create_client, Client
from supabase.client import ClientOptions

from . import datagen

logger = logging.getLogger(__name__)

MIN_PAUSE_SECONDS = 1.0
MAX_PAUSE_SECONDS = 30.0


def _source_names() -> list[str]:
    return [m.name for m in pkgutil.iter_modules(datagen.__path__)]


def _generate(name: str) -> Optional[str]:
    # Each datagen module exposes one function named after the module stem.
    module = importlib.import_module(f"{datagen.__name__}.{name}")
    return getattr(module, name)()


def _post_message(client: Client, text: str) -> None:
    client.functions.invoke("semgrep-api", invoke_options={"body": {"text": text}})


@click.command(short_help="Feed generated messages to the semgrep board")
def cli() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    url = os.environ["SEMGREP_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client = create_client(url, service_key, options=ClientOptions(function_client_timeout=30))

    sources = _source_names()
    logger.info(f"sources: {', '.join(sources)}")

    while True:
        name = random.choice(sources)

        try:
            text = _generate(name)
            if text:
                _post_message(client, text)
                logger.info(f"{name}: {text}")
            else:
                logger.warning(f"{name}: produced no message; skipped")
        except Exception as error:
            logger.error(f"{name}: {error}")

        time.sleep(random.uniform(MIN_PAUSE_SECONDS, MAX_PAUSE_SECONDS))


if __name__ == "__main__":
    cli()
