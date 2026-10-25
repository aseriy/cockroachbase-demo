import os

from supabase import acreate_client, create_client, AsyncClient, Client
from supabase.client import ClientOptions

url = os.environ["SEMGREP_URL"].rstrip("/")
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def get_client() -> Client:
    return create_client(url, service_key, options=ClientOptions(function_client_timeout=30))


async def get_async_client() -> AsyncClient:
    return await acreate_client(url, service_key)
