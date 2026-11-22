# Plays 1 second of a 440 Hz tone at -60 dB (amplitude 1/1000 of full scale): measurable by the peak meter, not audible
$rate = 44100; $samples = $rate; $data = $samples * 2
$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ms)
$w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $data)); $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
$w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1); $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
$w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$data)
for ($i = 0; $i -lt $samples; $i++) { $w.Write([int16]([Math]::Round(32.767 * [Math]::Sin(2 * [Math]::PI * 440 * $i / $rate)))) }
$ms.Position = 0
(New-Object System.Media.SoundPlayer($ms)).PlaySync()
