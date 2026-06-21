Add-Type -AssemblyName System.Drawing

$inputPath = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo.jpg'
$outputPath = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent.png'

$src = [System.Drawing.Bitmap]::new($inputPath)
$w = $src.Width
$h = $src.Height
$out = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

function Luma([System.Drawing.Color]$c) {
  return [double](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
}

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $c = $src.GetPixel($x,$y)
    $lum = Luma $c

    $a = 0
    if ($lum -lt 92) { $a = 255 }
    elseif ($lum -lt 145) { $a = [int](255 * (145 - $lum) / 53) }
    else { $a = 0 }

    # Preserve bright stars only if pixel is inside dark area neighborhood
    if ($lum -gt 220) {
      $nearDark = $false
      for ($dy = -2; $dy -le 2; $dy++) {
        for ($dx = -2; $dx -le 2; $dx++) {
          $nx = $x + $dx
          $ny = $y + $dy
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
          $n = $src.GetPixel($nx,$ny)
          if ((Luma $n) -lt 92) { $nearDark = $true; break }
        }
        if ($nearDark) { break }
      }
      if ($nearDark) { $a = 255 }
    }

    $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb($a,$c.R,$c.G,$c.B))
  }
}

$tmp = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent-new.png'
$out.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose(); $out.Dispose()
Move-Item -Force -Path $tmp -Destination $outputPath
Write-Output "Saved direct masked logo (no crop transforms): $outputPath"
