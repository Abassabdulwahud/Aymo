Add-Type -AssemblyName System.Drawing

$path = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent.png'
$tmp = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent-clean.png'
$bmp = [System.Drawing.Bitmap]::new($path)
$w = $bmp.Width
$h = $bmp.Height

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $c = $bmp.GetPixel($x,$y)
    if ($c.A -eq 0) { continue }

    $max = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
    $min = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
    $sat = $max - $min
    $lum = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)

    if ($sat -lt 24 -and $lum -gt 138) {
      $bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,$c.R,$c.G,$c.B))
    }
  }
}

$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Move-Item -Force -Path $tmp -Destination $path
Write-Output "Shadow cleanup applied and replaced: $path"
