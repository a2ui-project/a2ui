# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# The image of the hosted triage UI: the server, and the web app's files that
# it serves. See README.md.
#
# The build context is the repository root, because the packages are in the
# Dart workspace there. deploy.sh prepares it.

# 1. Build stage: Flutter, at the version the repository needs, builds the web
# app and compiles the server. Prebuilt Flutter images lag behind stable, so
# this clones the release tag.
FROM debian:bookworm-slim AS build
ARG FLUTTER_VERSION=3.50.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${FLUTTER_VERSION}" \
    https://github.com/flutter/flutter.git /opt/flutter
ENV PATH=/opt/flutter/bin:$PATH
RUN flutter --disable-analytics && flutter --version
WORKDIR /src
COPY . .
RUN flutter pub get
# TRIAGE_SERVER tells the app that the server serves it, so that it never
# keeps a token in the page's local storage.
RUN cd tools/internal/triage/pkgs/ui \
    && flutter build web --release --dart-define=TRIAGE_SERVER=true
RUN mkdir /out && dart compile exe \
    tools/internal/triage/pkgs/server/bin/server.dart -o /out/server

# 2. Run stage: only the server, the web app's files, and the CA certificates
# for HTTPS to GitHub. No Flutter or Dart SDK.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/server /app/server
COPY --from=build /src/tools/internal/triage/pkgs/ui/build/web /app/web
ENV WEB_DIR=/app/web
ENV PORT=8080
EXPOSE 8080
USER nobody
CMD ["/app/server"]
