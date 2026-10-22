import importlib
import logging
import pkgutil
import random
import time
from typing import Optional

from supabase import Client

from .. import datagen
from .common import client

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


def run_messages(args: dict) -> None:
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
