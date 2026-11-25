# syntax=docker/dockerfile:1

# Red Hat UBI build stage. Node.js 24 is the supported UBI runtime; the
# Vite/React bundle is built with the committed lockfile and no network at
# runtime.
ARG NODE_IMAGE=registry.access.redhat.com/ubi9/nodejs-24@sha256:0067c15398ece743e462637c8581b1b31027a7a2d3112e610ad700bde3b03f1b
ARG NGINX_IMAGE=registry.access.redhat.com/ubi9/nginx-126@sha256:a9948e4d1f7a5cd6e70e30e6c3a9746c6b5521eec93c41f1312fb083d3f7a677

FROM ${NODE_IMAGE} AS build
USER 0
WORKDIR /app
COPY --chown=1001:0 package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=1001:0 . .
RUN npm run build \
  && npm cache clean --force

# Red Hat UBI nginx runtime. The base image already runs as UID 1001 and
# exposes 8080; this layer only adds the static bundle and the entrypoint that
# renders the ConfigMap-provided nginx template.
FROM ${NGINX_IMAGE}
USER 0

LABEL name="pricetag-patternfly" \
      com.redhat.component="pricetag-patternfly-container" \
      version="0.1.0" \
      summary="PriceTag metering UI" \
      description="PatternFly 6 single-page UI for PriceTag usage, cost, team, key, and administration views." \
      vendor="Red Hat" \
      io.k8s.display-name="PriceTag" \
      io.k8s.description="PriceTag metering UI served by an unprivileged nginx reverse proxy." \
      io.openshift.tags="pricetag,metering,patternfly" \
      io.openshift.expose-services="8080:http" \
      org.opencontainers.image.source="https://github.com/cooktheryan/pricetag-patternfly" \
      org.opencontainers.image.title="PriceTag PatternFly UI" \
      org.opencontainers.image.description="OpenShift-hosted PriceTag metering UI and same-origin gateway proxy."

COPY --chown=1001:0 deploy/lib.sh /usr/local/bin/pricetag-lib.sh
COPY --chown=1001:0 deploy/entrypoint.sh /usr/local/bin/pricetag-entrypoint
COPY --from=build --chown=1001:0 /app/dist /usr/share/nginx/html

# All runtime writes go to /tmp (mounted emptyDir by the Deployment) so the
# container can run with a read-only root filesystem under restricted-v2.
RUN mkdir -p /etc/nginx/ca /etc/nginx/templates \
  && chmod 0755 /usr/local/bin/pricetag-entrypoint \
  && chmod 0644 /usr/local/bin/pricetag-lib.sh \
  && chmod -R a+rX /usr/share/nginx/html

USER 1001
EXPOSE 8080
STOPSIGNAL SIGQUIT
ENTRYPOINT ["/usr/local/bin/pricetag-entrypoint"]
CMD []
