# syntax=docker/dockerfile:1

# Build the Vite bundle with the lockfile, then serve it from an
# OpenShift-friendly unprivileged nginx. The runtime container needs no
# writable layer outside /tmp (the Deployment mounts an emptyDir there) and
# runs as a non-root UID under the restricted-v2 SCC.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

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
