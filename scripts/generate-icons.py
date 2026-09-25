from PIL import Image, ImageDraw, ImageFont
for name,size in [('icon-192.png',192),('icon-512.png',512),('icon-maskable.png',512)]:
 im=Image.new('RGB',(size,size),'#101b2c'); d=ImageDraw.Draw(im)
 pad=int(size*.18);d.rounded_rectangle((pad,pad,size-pad,size-pad),radius=int(size*.15),fill='#9fcce9')
 font=ImageFont.truetype('C:/Windows/Fonts/georgiaz.ttf',int(size*.53))
 d.text((size*.49,size*.43),'y',font=font,fill='#122638',anchor='mm')
 im.save('public/'+name)
