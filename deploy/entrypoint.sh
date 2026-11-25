#!/bin/sh
# Render the runtime nginx config from the environment, then run nginx in the
# foreground. Everything writable lives in /tmp so the Deployment can set
# readOnlyRootFilesystem and run under an arbitrary non-root UID.
set -eu
. /usr/local/bin/pricetag-lib.sh

: "${UPSTREAM:=https://32.198.91.108:8443}"
: "${UPSTREAM_PUBLIC_ORIGIN:=https://32.198.91.108:8443}"
: "${PUBLIC_ORIGIN:=http://localhost:8080}"
: "${UPSTREAM_TLS_NAME:?UPSTREAM_TLS_NAME is required (certificate DNS SAN; nginx does not verify IP SANs)}"

validate_origin "$UPSTREAM" UPSTREAM
validate_origin "$UPSTREAM_PUBLIC_ORIGIN" UPSTREAM_PUBLIC_ORIGIN
validate_origin "$PUBLIC_ORIGIN" PUBLIC_ORIGIN
validate_dns_name "$UPSTREAM_TLS_NAME" UPSTREAM_TLS_NAME

# nginx's proxy_ssl_trusted_certificate points here; fail early with a clear
# message instead of a generic nginx -t error.
[ -r /etc/nginx/ca/ca.crt ] || fail "missing /etc/nginx/ca/ca.crt (mount the gateway CA)"
[ -r /etc/nginx/templates/nginx.conf ] || fail "missing /etc/nginx/templates/nginx.conf (nginx config ConfigMap)"

# The template redirects the pid, access/error logs, and every temp path into
# /tmp, so nothing outside the emptyDir is written under the read-only root.
# nginx starts as the arbitrary UID (not root), so master and workers share
# it; 0700 is sufficient and no user directive drops privileges.
mkdir -p /tmp/client_body /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi
chmod 0700 /tmp/client_body /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi

# Longest placeholder first so no substitution can be a prefix of another.
sed \
  -e "s|\${UPSTREAM_PUBLIC_ORIGIN}|$(escape_sed "$UPSTREAM_PUBLIC_ORIGIN")|g" \
  -e "s|\${UPSTREAM}|$(escape_sed "$UPSTREAM")|g" \
  -e "s|\${PUBLIC_ORIGIN}|$(escape_sed "$PUBLIC_ORIGIN")|g" \
  -e "s|\${UPSTREAM_TLS_NAME}|$(escape_sed "$UPSTREAM_TLS_NAME")|g" \
  /etc/nginx/templates/nginx.conf > /tmp/nginx.conf

if grep -q '\${' /tmp/nginx.conf; then
  echo "unrendered placeholder in /tmp/nginx.conf" >&2
  exit 1
fi

nginx -t -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
