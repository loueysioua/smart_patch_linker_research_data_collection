#!/bin/bash

# Usage: ./run-fill-missing.sh <project_name_in_output>
# Example: ./run-fill-missing.sh libreoffice_changes

PROJECT=$1

if [ -z "$PROJECT" ]; then
  echo "Please provide a project name in the output directory."
  echo "Available projects:"
  ls -1 output/
  echo ""
  echo "Usage: ./run-fill-missing.sh <project_name>"
  exit 1
fi

TARGET_DIR="output/$PROJECT"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Directory $TARGET_DIR does not exist."
  exit 1
fi

echo "Running fill-missing script on $TARGET_DIR..."
npx ts-node src/fill-missing.ts "$TARGET_DIR"

