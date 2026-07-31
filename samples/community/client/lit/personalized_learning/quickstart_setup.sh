#!/bin/bash
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

# Quickstart Setup Script for Personalized Learning Demo
# This script handles all environment setup silently.
# Run from: samples/personalized_learning/

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
PROJECT_ID=""
SKIP_NPM=false
SKIP_PIP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --project)
            PROJECT_ID="$2"
            shift 2
            ;;
        --skip-npm)
            SKIP_NPM=true
            shift
            ;;
        --skip-pip)
            SKIP_PIP=true
            shift
            ;;
        -h|--help)
            echo "Usage: ./quickstart_setup.sh --project YOUR_PROJECT_ID [options]"
            echo ""
            echo "Options:"
            echo "  --project ID    Google Cloud project ID (required)"
            echo "  --skip-npm      Skip npm install steps"
            echo "  --skip-pip      Skip pip install steps"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: --project is required${NC}"
    echo "Usage: ./quickstart_setup.sh --project YOUR_PROJECT_ID"
    exit 1
fi

echo "============================================================"
echo "Personalized Learning Demo - Setup"
echo "============================================================"
echo "Project: $PROJECT_ID"
echo ""

# Step 1: Python Virtual Environment
echo -e "${YELLOW}[1/6]${NC} Setting up Python environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo "  Created virtual environment"
else
    echo "  Virtual environment already exists"
fi

# Activate venv for this script
source .venv/bin/activate

# Step 2: Install Python dependencies
if [ "$SKIP_PIP" = false ]; then
    echo -e "${YELLOW}[2/6]${NC} Installing Python dependencies..."
    pip install -q \
        --index-url https://pypi.org/simple/ \
        --trusted-host pypi.org \
        --trusted-host files.pythonhosted.org \
        "google-adk>=1.28.1" \
        "google-genai>=1.27.0" \
        "google-cloud-storage>=2.10.0" \
        "python-dotenv>=1.0.0" \
        "vertexai" 2>/dev/null
    echo "  Python dependencies installed"
else
    echo -e "${YELLOW}[2/6]${NC} Skipping Python dependencies (--skip-pip)"
fi

# Step 3: Install Node.js dependencies
if [ "$SKIP_NPM" = false ]; then
    echo -e "${YELLOW}[3/6]${NC} Installing Node.js dependencies..."

    # Install repository dependencies and link workspaces
    (cd ../../../.. && yarn install --silent 2>/dev/null)
    echo "  Workspace dependencies installed and linked"
    echo "  Demo dependencies installed"
else
    echo -e "${YELLOW}[3/6]${NC} Skipping Node.js dependencies (--skip-npm)"
fi

# Step 4: Enable GCP APIs
echo -e "${YELLOW}[4/6]${NC} Enabling GCP APIs..."
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null
gcloud services enable cloudbuild.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null
gcloud services enable storage.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null
gcloud services enable cloudresourcemanager.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null
echo "  APIs enabled"

# Step 5: Create GCS buckets
echo -e "${YELLOW}[5/6]${NC} Creating GCS buckets..."
LOCATION="us-central1"

# Staging bucket
gcloud storage buckets create "gs://${PROJECT_ID}_cloudbuild" --location "$LOCATION" 2>/dev/null || true
echo "  Staging bucket: gs://${PROJECT_ID}_cloudbuild"

# Learner context bucket
CONTEXT_BUCKET="${PROJECT_ID}-learner-context"
gcloud storage buckets create "gs://${CONTEXT_BUCKET}" --location "$LOCATION" 2>/dev/null || true
echo "  Context bucket: gs://${CONTEXT_BUCKET}"

# OpenStax content bucket
OPENSTAX_BUCKET="${PROJECT_ID}-openstax"
gcloud storage buckets create "gs://${OPENSTAX_BUCKET}" --location "$LOCATION" 2>/dev/null || true
echo "  OpenStax bucket: gs://${OPENSTAX_BUCKET}"

# Step 6: Upload learner context
echo -e "${YELLOW}[6/6]${NC} Uploading learner context files..."
gcloud storage cp learner_context/*.txt "gs://${CONTEXT_BUCKET}/learner_context/" 2>/dev/null|| true
echo "  Learner context uploaded to gs://${CONTEXT_BUCKET}/learner_context/"

# Get project number for .env
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null)

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "Project ID:     $PROJECT_ID"
echo "Project Number: $PROJECT_NUMBER"
echo "Context Bucket: gs://${CONTEXT_BUCKET}/learner_context/"
echo ""
echo "Next steps:"
echo "  1. Run the 'Deploy Agent' cell in the notebook"
echo "  2. Copy the Resource ID and paste it in the configuration cell"
echo "  3. Run 'yarn dev' to start the demo"
echo ""

# Output values for notebook to capture
echo "SETUP_PROJECT_ID=$PROJECT_ID"
echo "SETUP_PROJECT_NUMBER=$PROJECT_NUMBER"
echo "SETUP_CONTEXT_BUCKET=$CONTEXT_BUCKET"
