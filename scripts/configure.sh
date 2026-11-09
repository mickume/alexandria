#!/usr/bin/env bash
# Sets the per-deployment settings of Alexandria on Cloudflare from a local
# .env file (or the file given as the first argument), in one
# `wrangler secret bulk` call. Every setting is stored as a Worker secret, so
# that a deploy, by Workers Builds or otherwise, keeps it.
#
# The file holds one NAME=value per line; blank lines and lines starting with
# # are skipped, and quotes around a value are removed as in any .env file (a
# value holding # or spaces needs them).
# The names it may set are the five below. CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID may be in it too: they are used to reach the account
# (unless already set in the environment) and never uploaded. Any other name,
# an empty value or a line that is not NAME=value stops the script before
# anything is sent. Values are never printed.
set -euo pipefail

SETTINGS=" ALLOWED_EMAILS GOOGLE_CLIENT_ID PUBLIC_ORIGIN GOOGLE_CLIENT_SECRET KEY_ENCRYPTION_KEY "
ACCOUNT=" CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID "

# A file named on the command line is found from where the script was run;
# the default .env is the checkout's.
if [ $# -gt 0 ]; then file=$1; else file="$(cd "$(dirname "$0")/.." && pwd)/.env"; fi
if [ ! -f "$file" ]; then
  echo "No $file: copy .env.example to .env and fill it in, or name the file to read." >&2
  exit 1
fi
file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
cd "$(dirname "$0")/.."

# A value as wrangler's .env parser reads it: without the spaces and quotes
# around it, and, unquoted, up to its first #, where a comment starts.
unquote() {
  local value=$1
  value=${value#"${value%%[![:space:]]*}"}
  value=${value%"${value##*[![:space:]]}"}
  case $value in
    \"*\" | \'*\') value=${value:1:${#value}-2} ;;
    *) value=${value%%#*} ;;
  esac
  printf '%s' "$value"
}

upload=""
names=""
errors=0
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  line=${line%$'\r'}
  trimmed=${line#"${line%%[![:space:]]*}"}
  case $trimmed in
    "" | \#*) continue ;;
  esac
  if [[ $trimmed != *=* ]]; then
    echo "$file:$n: not NAME=value" >&2
    errors=1
    continue
  fi
  name=${trimmed%%=*}
  name=${name#export }
  name=${name//[[:space:]]/}
  value=$(unquote "${trimmed#*=}")
  if [[ ! $name =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "$file:$n: not NAME=value" >&2
    errors=1
  elif [ -z "$value" ]; then
    echo "$file:$n: $name is empty; remove the line to leave it as it is" >&2
    errors=1
  elif [[ $ACCOUNT == *" $name "* ]]; then
    # The environment wins over the file, as with any .env file.
    if [ -z "${!name:-}" ]; then export "$name=$value"; fi
  elif [[ $SETTINGS == *" $name "* ]]; then
    upload+="$name=${trimmed#*=}"$'\n'
    names+=" $name"
  else
    echo "$file:$n: $name is not a setting of a deployment (those are:${SETTINGS% })" >&2
    errors=1
  fi
done <"$file"

if [ "$errors" = 1 ]; then
  echo "Nothing was sent." >&2
  exit 1
fi
if [ -z "$names" ]; then
  echo "$file sets none of:${SETTINGS% }" >&2
  exit 1
fi

echo "Setting$names"
# Through stdin, so that the values never reach a file or the command line.
printf '%s' "$upload" | npx --no-install wrangler secret bulk
