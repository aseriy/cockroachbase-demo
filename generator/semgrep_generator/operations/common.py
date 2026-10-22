import os

from supabase import create_client, Client
from supabase.client import ClientOptions

url = os.environ["SEMGREP_URL"].rstrip("/")
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
client: Client = create_client(url, service_key, options=ClientOptions(function_client_timeout=30))
