#!/bin/sh
# Final e2e batch in WSL, one run after another: Firefox 160, Microsoft Edge 158 and Chrome for Testing 158 (Linux).
# Edge/Chromium have no audio device (silentEnv() in chromium.mjs).  Results in final/batch-linux2/.
SP=<WORKDIR>
export E2E_EDGE=$HOME/snaplinks-e2e-browsers/edge-dl/root/opt/microsoft/msedge/msedge
export E2E_CHROMIUM=$HOME/snaplinks-e2e-browsers/chrome-dl/chrome-linux64/chrome
cd "$SP/final" || exit 1
O=batch-linux2
mkdir -p $O
: > $O/SUMMARY.txt
run() {
	name=$1; shift
	timeout 1500 node e2e.mjs --fixtures /mnt/v/SnapLinksPlus/test --out "$SP/final/$O/$name.json" "$@" > "$O/$name.log" 2>&1
	echo "$name exit=$? $(grep -cE '^ +[0-9]+ .* PASS' $O/$name.log) pass, $(grep -cE '^ +[0-9]+ .* FAIL' $O/$name.log) fail, $(grep -cE '^ +[0-9]+ .* SKIP' $O/$name.log) skip" >> $O/SUMMARY.txt
}
ALL=1,2,3,4,5,6,7,8,9,10,11,12,13
run ff-mv2      --build "$SP/baseline-mv2/ff" --scenarios $ALL
run ff-pr3      --build "$SP/pr3-build/ff" --upgrade-from "$SP/baseline-mv2/ff" --scenarios $ALL
run ff-pr3-idle --build "$SP/pr3-build/ff" --idle-timeout 3000 --scenarios 1,2,3,4,10,12
run edge-mv2    --browser edge --build "$SP/baseline-mv2/chrome"
run edge-pr1    --browser edge --build "$SP/pr1-build/chrome"
run edge-pr3    --browser edge --build "$SP/pr3-build/chrome"
run chromium-pr3      --browser chromium --build "$SP/pr3-build/chrome"
run chromium-pr3-idle --browser chromium --build "$SP/pr3-build/chrome" --idle-timeout 30000 --scenarios 1,2,10
run edge-mv2-perf --browser edge --build "$SP/baseline-mv2/chrome" --scenarios 12 --perf-runs 20
run edge-pr3-perf --browser edge --build "$SP/pr3-build/chrome" --scenarios 12 --perf-runs 20
echo DONE >> $O/SUMMARY.txt
cat $O/SUMMARY.txt
