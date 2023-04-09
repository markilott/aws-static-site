#!/bin/bash
# Run lint on all files
set -e

echo Running lint...
(eslint .)
