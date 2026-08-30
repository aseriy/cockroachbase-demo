import random
import requests

OFFLINE_BACKUPS = [
    "Chuck Norris counted to infinity. Twice.",
    "Chuck Norris can delete the Recycling Bin.",
    "When Chuck Norris does a pushup, he's pushing the Earth down."
]
url = "https://api.chucknorris.io/jokes/random"
headers = {"User-Agent": "Mozilla/5.0"}


def chuck_norris_joke():
    output = None

    try:
        response = requests.get(url, headers=headers, timeout=5)

        # Drop the strict .startswith check; rely completely on standard status code
        if response.status_code == 200:
            data = response.json()
            output = f"{data['value']}"
        else:
            # Fall back if the server returns a 4xx/5xx code
            fallback_fact = random.choice(OFFLINE_BACKUPS)
            output = f"{response.status_code}): {fallback_fact}"

    except (requests.exceptions.RequestException, ValueError, KeyError):
        # Fallback only if the internet dies or JSON format is completely invalid
        fallback_fact = random.choice(OFFLINE_BACKUPS)
        output = f"{fallback_fact}"


    return output
