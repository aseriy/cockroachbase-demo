import random
import requests


def random_quote():
    # Local offline backup in case the network blocks you entirely
    OFFLINE_BACKUPS = [
        "Before you judge a man, walk a mile in his shoes.",
        "The early bird gets the worm, but the second mouse gets the cheese.",
        "If you want to go fast, go alone. If you want to go far, go together.",
        "No snowflake in an avalanche ever feels responsible."
    ]

    url = "https://api.adviceslip.com/advice"

    # Force a legitimate browser header to stop Cloudflare/firewall blocks
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    output = ""

    try:
        # Fetch with user headers and a short timeout
        response = requests.get(url, headers=headers, timeout=5)

        # Verify the body isn't an empty response or an HTML string
        if response.status_code == 200 and response.text.strip().startswith("{"):
            data = response.json()
            output = f"{data['slip']['advice']}"

    except (requests.exceptions.RequestException, ValueError, KeyError):
        # If anything breaks (network down, bad JSON, missing keys), use the fallback
        fallback_text = random.choice(OFFLINE_BACKUPS)
        output = f"{fallback_text}"


    return output
