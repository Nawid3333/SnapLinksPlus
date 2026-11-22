#!/bin/sh
# Downloads the official Firefox Developer Edition for Linux into its own empty directory and unpacks it
set -e
D=<WORKDIR>/devedition-dl
mkdir -p "$D"
cd "$D"
curl -sSfL -o devedition.tar "https://download.mozilla.org/?product=firefox-devedition-latest-ssl&os=linux64&lang=en-US"
file devedition.tar
tar -xf devedition.tar
ls
./firefox/firefox --version
