#!/bin/bash
set -e
cd "$(dirname "$0")"

TIMESTAMP=$(date +%s)

echo "Fetching zhihu/follow..."
bb-browser site zhihu/follow 50 --jq '.' > "data/zhihu-follow-${TIMESTAMP}.json"

echo "Fetching zhihu/recommend..."
bb-browser site zhihu/recommend 50 --jq '.' > "data/zhihu-recommend-${TIMESTAMP}.json"

echo "Fetching twitter/following..."
bb-browser site twitter/following 50 --jq '.' > "data/twitter-following-${TIMESTAMP}.json"

echo "Fetching twitter/recommend..."
bb-browser site twitter/recommend 50 --jq '.' > "data/twitter-recommend-${TIMESTAMP}.json"

echo "Done!"
ls -la data/
