#!/bin/bash
set -e

cd /home/nima/dana

# Install backend dependencies
cd app/backend && bun install
cd ../..

# Ensure data directories exist
mkdir -p data
