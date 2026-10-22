#!/bin/bash

# Exit immediately if a command fails
set -e

# Setup a trap to kill all background processes if the script receives a SIGTERM/SIGINT
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Bake the deployment values into the page before serving it
sed -i \
    -e "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" \
    -e "s|__SUPABASE_URL__|${SEMGREP_EXTERNAL_URL}|g" \
    /app/ui/index.html

# Start the web server in the background
nginx -g 'daemon off;' &

# Start the message generator in the background
generator_messages &

# Wait for ANY background process to exit or fail
wait -n

# Once wait -n unblocks, it means one process folded.
# Exit the wrapper script, which triggers the trap above and kills the survivor.
exit 1
