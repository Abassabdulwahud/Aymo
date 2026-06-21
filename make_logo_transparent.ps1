Add-Type -AssemblyName System.Drawing
$inputPath = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo.jpg'
$outputPath = 'C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent.png'
$bmp = [System.Drawing.Bitmap]::new($inputPath)
$w = $bmp.Width; $h = $bmp.Height
$outBmp = [System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for($y=0;$y -lt $h;$y++){
  for($x=0;$x -lt $w;$x++){
    $c=$bmp.GetPixel($x,$y)
    if($c.R -ge 238 -and $c.G -ge 238 -and $c.B -ge 238){
      $outBmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,$c.R,$c.G,$c.B))
    }else{
      $outBmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$c.R,$c.G,$c.B))
    }
  }
}
$outBmp.Save($outputPath,[System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose();$outBmp.Dispose()
Write-Output 'Restored clean transparent version.'
