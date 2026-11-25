#!/bin/sh
# Shared validation for the host-side renderer (deploy.sh) and the container
# entrypoint. POSIX sh so the entrypoint can source it in the alpine image.
# Accepted values are origins/upstreams only: scheme://host[:port], with no
# userinfo, path, query, fragment, or trailing slash. IPv6 literals are
# deliberately unsupported (nginx's proxy_ssl_name contract here is a DNS
# name, and the deployment's gateway is addressed by IPv4).

fail() {
  echo "$*" >&2
  exit 1
}

validate_host() {
  host=$1
  name=$2
  [ -n "$host" ] || fail "$name has an empty host"
  case "$host" in
    *[!A-Za-z0-9.-]*) fail "$name host contains unsupported characters" ;;
    .*|*.|*..*) fail "$name host has an empty label" ;;
  esac
  old_ifs=$IFS
  IFS=.
  for label in $host; do
    if [ "${#label}" -lt 1 ] || [ "${#label}" -gt 63 ]; then
      IFS=$old_ifs
      fail "$name host label length is invalid"
    fi
    case "$label" in
      -*|*-)
        IFS=$old_ifs
        fail "$name host label starts or ends with '-'"
        ;;
    esac
  done
  IFS=$old_ifs
}

validate_origin() {
  value=$1
  name=$2
  case "$value" in
    *[[:cntrl:]]*) fail "$name contains control characters" ;;
  esac
  case "$value" in
    http://*|https://*) ;;
    *) fail "$name must start with http:// or https://" ;;
  esac
  authority=${value#*://}
  case "$authority" in
    ''|*[/?#@]*) fail "$name must be scheme://host[:port] (no userinfo, path, query, or trailing slash)" ;;
    *:*:*) fail "$name must be scheme://host[:port] (IPv6 and multiple colon separators are not supported)" ;;
  esac
  host=${authority%%:*}
  case "$authority" in
    *:*)
      port=${authority##*:}
      case "$port" in
        ''|*[!0-9]*) fail "$name has an invalid port" ;;
      esac
      [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "$name port must be 1..65535"
      ;;
  esac
  validate_host "$host" "$name"
}

validate_dns_name() {
  name=$1
  label=$2
  case "$name" in
    *[[:cntrl:]]*) fail "$label contains control characters" ;;
  esac
  [ "${#name}" -ge 1 ] && [ "${#name}" -le 253 ] || fail "$label must be 1..253 characters"
  # An all-numeric-dot value is an IP literal, not a DNS name; nginx checks
  # DNS SANs (not IP SANs), so reject it before it reaches proxy_ssl_name.
  case "$name" in
    *[!0-9.]*) ;;
    *) fail "$label must be a DNS name, not an IP address" ;;
  esac
  validate_host "$name" "$label"
}

escape_sed() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}
