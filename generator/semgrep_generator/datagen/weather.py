import random
import requests
from urllib.parse import urljoin

cities = ["tokyo", "london", "paris", "sydney", "cairo", "boston", "new york", "berlin", "hamburg", "edinburgh", "chicago", "miami", "tokyo"]


def weather():
    random_city = random.choice(cities)

    # Use urljoin to strictly force a clean domain/path separation
    base_url = "https://wttr.in"
    city_path = f"{random_city}?format=j1"
    full_url = urljoin(base_url, city_path)

    output = None

    try:
        response = requests.get(full_url, timeout=10)

        if response.status_code != 200:
            output = f"Server Error Status: {response.status_code}"
        else:
            data = response.json()
            # Extract fields safely using .get() to prevent KeyError crashes
            current_condition = data.get("current_condition", [{}])[0]
            temp_c = current_condition.get("temp_C", "N/A")

            weather_desc_list = current_condition.get("weatherDesc", [{}])
            desc = weather_desc_list[0].get("value", "N/A") if weather_desc_list else "N/A"

            output = f"Weather in {random_city.title()}: {temp_c}°C, {desc}"

    except requests.exceptions.RequestException as error:
        # print(f"Network request entirely failed: {error}")
        # print(f"Attempted URL was: {full_url}")
        pass

    except (ValueError, KeyError, IndexError) as parse_error:
        output = f"Data parsing failed: {parse_error}"


    return output
