#!/bin/bash

echo Lambda tools layer
(cd src/lambda/tools-layer/nodejs && npm ci --omit=dev)

echo Web site build
(cd src/web && npm ci && npm run build)

if [ ! -f config/local.ts ]; then
    echo creating local config file
    cp config/template.ts config/local.ts
fi
