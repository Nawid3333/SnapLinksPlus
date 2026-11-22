# Plays 2 seconds of digital silence through PlaySound (System.Media.SoundPlayer): an inaudible positive control for watch.ps1
$rate = 44100; $samples = $rate * 2; $data = $samples * 2
$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ms)
$w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $data)); $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
$w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1); $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
$w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$data); $w.Write((New-Object byte[] $data))
$ms.Position = 0
(New-Object System.Media.SoundPlayer($ms)).PlaySync()
