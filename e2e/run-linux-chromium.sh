#!/bin/sh
# Edge/Chromium e2e runs in WSL (no audio device for the browser, see silentEnv() in chromium.mjs).
# Usage: run-linux-chromium.sh <name> <harness args...>   (log and results in final/batch-linux/)
SP=<WORKDIR>
export E2E_EDGE=$HOME/snaplinks-e2e-browsers/edge-dl/root/opt/microsoft/msedge/msedge
export E2E_CHROMIUM=$HOME/snaplinks-e2e-browsers/chrome-dl/chrome-linux64/chrome
cd "$SP/final" || exit 1
mkdir -p batch-linux
name=$1; shift
timeout 1500 node e2e.mjs --fixtures /mnt/v/SnapLinksPlus/test --out "$SP/final/batch-linux/$name.json" "$@" > "batch-linux/$name.log" 2>&1
code=$?
echo "$name exit=$code $(grep -cE '^ +[0-9]+ .* PASS' batch-linux/$name.log) pass, $(grep -cE '^ +[0-9]+ .* FAIL' batch-linux/$name.log) fail" | tee -a batch-linux/SUMMARY-chromium.txt
