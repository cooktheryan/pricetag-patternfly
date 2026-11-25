# Deploying the PriceTag SPA

Image: `quay.io/redhat-et/patternfly:pricetag-ui` (public repository; pulls
need no image pull secret). The `redhat-et+enmaas` robot currently has
**pull-only** on `redhat-et/patternfly`; grant it **Write** in the repository
settings before pushing.

## Build and push

```sh
deploy/build.sh                              # linux/amd64 by default
podman login quay.io -u 'redhat-et+enmaas'   # robot token from your secret store
podman push quay.io/redhat-et/patternfly:pricetag-ui
```

For a local smoke test, run the image directly:

```sh
podman run --rm -p 8080:8080 \
  -e UPSTREAM=https://32.198.91.108:8443 \
  -e UPSTREAM_PUBLIC_ORIGIN=https://32.198.91.108:8443 \
  -e PUBLIC_ORIGIN=http://localhost:8080 \
  -e UPSTREAM_TLS_NAME=localhost \
  -v "$HOME/.config/praxis-pricetag/32.198.91.108/ca.pem:/etc/nginx/ca/ca.crt:ro" \
  quay.io/redhat-et/patternfly:pricetag-ui
```

The entrypoint validates the URLs and TLS name before rendering nginx; it
refuses to start on an unsupported scheme or injected characters. The
container runs as a non-root UID, so ensure the mounted CA file is
world-readable (copy it and `chmod 0644` if the source is `0600`).

## Deploy to the emerg cluster

```sh
CA_FILE="$HOME/.config/praxis-pricetag/32.198.91.108/ca.pem" \
UPSTREAM_TLS_NAME=localhost \
deploy/deploy.sh
```

`UPSTREAM_TLS_NAME` is required: nginx verifies DNS SANs, not IP SANs, so it
must name a DNS SAN on the gateway certificate (`localhost` for the Praxis
gateway) even though the TCP target is its IP.

The script:

1. validates the upstream/CA and confirms the chosen `UPSTREAM_TLS_NAME` is
   a DNS SAN on the live certificate (chain and hostname included);
2. applies the `pricetag-patternfly` namespace, Service, the nginx-config
   ConfigMap, and the bundled public Praxis test CA ConfigMap (refreshed from
   `CA_FILE` for the target environment);
3. resolves the public host from an existing Route or the cluster ingress
   domain, renders the Deployment with `PUBLIC_ORIGIN=https://<host>`, and
   rolls it out;
4. applies the Route last, with that explicit host, and waits for admission;
5. prints the URL.

The Deployment's readiness probe requests `/whoami` through the proxy, so a
missing CA, broken chain, or unreachable upstream marks the pod unready;
liveness only checks the static SPA. The nginx config is a ConfigMap, not a
baked image file, so it can be reviewed and updated without rebuilding.

## Why the proxy rewrites Origin

The live gateway enforces CSRF on `/login`, `/logout`, and
`/admin/impersonate` by requiring `Origin == MANAGEMENT_PUBLIC_ORIGIN` and
`Sec-Fetch-Site != cross-site` (`internal/handler/auth.go`). The browser's
Origin is the Route, not the gateway's own origin, so nginx maps exactly that
same-origin value to `UPSTREAM_PUBLIC_ORIGIN`. A cross-site Origin passes
through unchanged and the gateway rejects it; the session cookie is also
HttpOnly + SameSite=Lax. No gateway configuration change is required, and
`PUBLIC_ORIGIN` must match the URL users actually open (the script derives
it from the Route).

The gateway's certificate is private-CA-signed and carries
`IP:32.198.91.108` plus `DNS:localhost`. nginx verifies the chain with
`/etc/nginx/ca/ca.crt` and, because its upstream hostname check matches DNS
SANs rather than IP SANs, sets `UPSTREAM_TLS_NAME=localhost` for SNI and
verification while `proxy_pass` still connects to `32.198.91.108:8443`.
TLS validation is never disabled.

## Scope

The live AWS gateway is read-only for this UI. Destructive flows (key
create/revoke, admin writes) are tested against the local standalone stack,
never the live gateway.

## Security controls applied by the script

- nginx injects CSP/HSTS/nosniff/frame/referrer/permissions/COOP/CORP headers
  on every response and clears client-supplied identity headers before
  proxying.
- `networkpolicy.yaml` allows ingress only from the OpenShift ingress
  namespace and cluster nodes on 8080, and egress only to DNS and
  `32.198.91.108:8443`.
- Pin the image by digest for production:
  `IMAGE=quay.io/redhat-et/patternfly:pricetag-ui@sha256:<digest> deploy/deploy.sh`.
