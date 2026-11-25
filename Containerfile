# syntax=docker/dockerfile:1

# Build the Vite bundle with the lockfile, then serve it from an
# OpenShift-friendly unprivileged nginx. The runtime container needs no
# writable layer outside /tmp (the Deployment mounts an emptyDir there) and
# runs as a non-root UID under the restricted-v2 SCC.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0

USER root
COPY deploy/lib.sh /usr/local/bin/pricetag-lib.sh
COPY deploy/entrypoint.sh /usr/local/bin/pricetag-entrypoint
COPY --from=build /app/dist /usr/share/nginx/html
# OpenShift ignores USER and assigns an arbitrary UID. Every runtime-read
# path is world-readable; all writes go to the /tmp emptyDir. The nginx
# template is a ConfigMap mounted at /etc/nginx/templates by the Deployment.
# The custom ENTRYPOINT replaces the base image's startup scripts, so no
# inherited script tries to write outside /tmp. UID 101 is only the local
# podman default from the unprivileged base image.
# The read-only CA ConfigMap (defaultMode 0444) is mounted at
# /etc/nginx/ca by the Deployment; the placeholder lets a local run without
# the mount fail with the entrypoint's clear message.
RUN mkdir -p /etc/nginx/ca \
  && chmod 0755 /etc/nginx/ca \
  && chmod 0755 /usr/local/bin/pricetag-entrypoint \
  && chmod 0644 /usr/local/bin/pricetag-lib.sh \
  && chmod -R a+rX /usr/share/nginx/html
USER 101

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/pricetag-entrypoint"]
