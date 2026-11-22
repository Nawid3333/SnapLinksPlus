#!/bin/sh
# Downloads official Linux builds of Chrome for Testing (Google) and Microsoft Edge (Microsoft) into their own new
# directories and unpacks them without installing anything system-wide.
set -e
SP=<WORKDIR>
D=$HOME/snaplinks-e2e-browsers		# Linux filesystem: Chromium refuses some operations on /mnt/c
rm -rf "$D" && mkdir -p "$D/chrome-dl" "$D/edge-dl"

# Chrome for Testing, stable, from Google's published list of downloads
url=$(curl -sSf https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json \
	| node -e "let j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.channels.Stable.downloads.chrome.find(d=>d.platform==='linux64').url)")
echo "chrome: $url"
curl -sSfL -o "$D/chrome-dl/chrome.zip" "$url"
cd "$D/chrome-dl" && python3 -c "import zipfile,sys; zipfile.ZipFile('chrome.zip').extractall('.')" && chmod +x chrome-linux64/chrome chrome-linux64/chrome_crashpad_handler 2>/dev/null || true
"$D/chrome-dl/chrome-linux64/chrome" --version

# Microsoft Edge stable for Linux, the newest .deb in Microsoft's repository
deb=$(curl -sSf https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/ | grep -o 'microsoft-edge-stable_[0-9.]*-1_amd64\.deb' | sort -uV | tail -1)
echo "edge: $deb"
curl -sSfL -o "$D/edge-dl/edge.deb" "https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/$deb"
dpkg-deb -x "$D/edge-dl/edge.deb" "$D/edge-dl/root"
"$D/edge-dl/root/opt/microsoft/msedge/msedge" --version
echo "browsers in $D"
