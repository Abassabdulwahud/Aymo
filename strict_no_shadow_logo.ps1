Add-Type -AssemblyName System.Drawing
$in='C:\Users\DeLL\Desktop\aymo\public\aymo-logo.jpg'
$out='C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent.png'
$src=[System.Drawing.Bitmap]::new($in)
$bmp=[System.Drawing.Bitmap]::new($src.Width,$src.Height,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for($y=0;$y -lt $src.Height;$y++){
  for($x=0;$x -lt $src.Width;$x++){
    $c=$src.GetPixel($x,$y)
    $lum=[int](0.299*$c.R+0.587*$c.G+0.114*$c.B)
    if($lum -lt 96){
      $bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$c.R,$c.G,$c.B))
    } elseif($lum -lt 112){
      $a=[int](255*(112-$lum)/16)
      $bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb($a,$c.R,$c.G,$c.B))
    } else {
      $bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,$c.R,$c.G,$c.B))
    }
  }
}
$tmp='C:\Users\DeLL\Desktop\aymo\public\aymo-logo-transparent-new.png'
$bmp.Save($tmp,[System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose();$bmp.Dispose(); Move-Item -Force $tmp $out
Write-Output 'Applied strict threshold shadow removal.'
