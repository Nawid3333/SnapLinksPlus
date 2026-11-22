# Polls the playing audio sessions every 50 ms for -Seconds; a session is logged (START) as soon as it plays.  Per session (pid) it records when it was first seen playing
# and the highest signal peak (0..1) measured: peak 0 means silence, anything above about 0.001 is sound.
# Usage: pwsh -File watch.ps1 -Seconds 60 -Out log.txt
param([int]$Seconds = 60, [string]$Out = "$PSScriptRoot\watch.log")
Add-Type -Path "$PSScriptRoot\AudioWatch.cs"
$scratch = '<WORKDIR-MARKER>'
$found = @{}
"watch start $(Get-Date -Format 'HH:mm:ss.fff')" | Set-Content $Out
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
	foreach ($s in [AudioWatch]::ActiveSessions()) {
		$procId, $kind, $peak = $s.Split('|')
		$key = "$procId|$kind"
		if (-not $found.ContainsKey($key)) {
			$p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
			$type = if ($p.CommandLine -match '--type=(\S+)') { $Matches[1] } elseif ($p) { 'main' } else { '' }
			$found[$key] = [pscustomobject]@{ First = (Get-Date -Format 'HH:mm:ss.fff'); Pid = $procId; Name = $p.Name; Type = $type; Kind = $kind; Test = [bool]($p.CommandLine -match $scratch); MaxPeak = [double]$peak }
			"{0}  START pid={1}  {2}  type={3}  {4}  test={5}" -f $found[$key].First, $procId, $p.Name, $type, $kind, $found[$key].Test | Add-Content $Out
		} elseif ([double]$peak -gt $found[$key].MaxPeak) {
			$found[$key].MaxPeak = [double]$peak
		}
	}
	Start-Sleep -Milliseconds 50
}
$found.Values | Sort-Object First | ForEach-Object { "{0}  pid={1}  {2}  type={3}  {4}  test={5}  maxPeak={6:0.00000}" -f $_.First, $_.Pid, $_.Name, $_.Type, $_.Kind, $_.Test, $_.MaxPeak } | Add-Content $Out
"watch end $(Get-Date -Format 'HH:mm:ss.fff')" | Add-Content $Out
