import importlib
import logging
import os
import pkgutil
import random
import time
from typing import Optional

import click
import requests

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


def _post_message(url: str, service_key: str, text: str) -> None:
    response = requests.post(
        f"{url}/functions/v1/semgrep-api",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        json={"text": text},
        timeout=30,
    )
    response.raise_for_status()


@click.command(short_help="Feed generated messages to the semgrep board")
def cli() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    url = os.environ["SEMGREP_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    sources = _source_names()
    logger.info(f"sources: {', '.join(sources)}")

    while True:
        name = random.choice(sources)

        try:
            text = _generate(name)
            if text:
                _post_message(url, service_key, text)
                logger.info(f"{name}: {text}")
            else:
                logger.warning(f"{name}: produced no message; skipped")
        except Exception as error:
            logger.error(f"{name}: {error}")

        time.sleep(random.uniform(MIN_PAUSE_SECONDS, MAX_PAUSE_SECONDS))


if __name__ == "__main__":
    cli()
