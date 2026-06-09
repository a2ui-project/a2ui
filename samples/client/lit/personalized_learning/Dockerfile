# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Personalized Learning Demo - Cloud Run Dockerfile
# Serves both the Vite frontend and the API server

FROM node:20-slim

WORKDIR /app

# Copy everything first
COPY . .

# Update package.json to point to the local copy instead of ../../renderers/lit
RUN sed -i 's|file:../../renderers/lit|file:./a2ui-web-lib|g' package.json

# Rename the package from @a2ui/lit to @a2ui/web-lib so imports resolve correctly
# (the source code imports from @a2ui/web-lib but the actual package is @a2ui/lit)
RUN sed -i 's|"name": "@a2ui/lit"|"name": "@a2ui/web-lib"|g' a2ui-web-lib/package.json

# Remove prepack script to prevent rebuild during yarn install
# (we copy pre-built dist/; the wireit build references ../../specification/ which doesn't exist)
RUN sed -i '/"prepack":/d' a2ui-web-lib/package.json

# Enable Corepack for modern Yarn (v4) support
RUN corepack enable

# Install dependencies using Yarn
RUN yarn install

# Build the Vite frontend
RUN yarn build

# Set production environment
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Run the API server (serves both API and static files in production)
CMD ["yarn", "tsx", "api-server.ts"]
