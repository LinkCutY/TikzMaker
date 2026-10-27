"""Deterministic reference images; only the remote model reconstructs them."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

OUT = Path('.probe-tests/fixtures')
OUT.mkdir(parents=True, exist_ok=True)
FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)

def canvas():
    im = Image.new('RGB', (640, 420), 'white')
    return im, ImageDraw.Draw(im)

def text(d, xy, value):
    d.text(xy, value, font=FONT, fill='#202028')

im, d = canvas()
for x, title in [(35, 'Input'), (245, 'Process'), (455, 'Output')]:
    d.rounded_rectangle((x, 160, x+150, 240), 10, fill='#e4eafa', outline='#354f86', width=2)
    text(d, (x+30, 185), title)
for a,b in [(185,245),(395,455)]:
    d.line((a,200,b,200),fill='#354f86',width=3)
    d.polygon([(b,200),(b-12,194),(b-12,206)],fill='#354f86')
im.save(OUT/'flowchart.png')

im,d=canvas()
d.rectangle((65,45,600,350),outline='#333333',width=2)
for color,phase in [('#6951a5',0),('#bf843d',math.pi/2)]:
    pts=[(65+i*535/240,197-105*math.sin(i/240*4*math.pi+phase)) for i in range(241)]
    d.line(pts, fill=color,width=3)
text(d,(265,375),'Time (s)')
text(d,(80,55),'Signal A / B')
im.save(OUT/'curves.png')

im,d=canvas()
d.line((70,50,70,350,600,350),fill='#333333',width=2)
for j,(height,color) in enumerate([(90,'#6c90bd'),(190,'#8c70ac'),(140,'#62a28c'),(250,'#d49a50')]):
    x=120+j*115
    d.rectangle((x,350-height,x+65,350),fill=color)
    text(d,(x+22,365),chr(65+j))
text(d,(200,20),'Measured response')
im.save(OUT/'bars.png')

im,d=canvas()
d.ellipse((165,55,475,365),outline='#526b9c',width=3)
d.line((320,55,186,287,454,287,320,55),fill='#a76983',width=3)
d.line((320,55,320,287),fill='#777777',width=2)
for pos,label in [((310,25),'A'),((160,290),'B'),((460,290),'C'),((325,290),'O')]:text(d,pos,label)
im.save(OUT/'geometry.png')

im,d=canvas()
layers=[[(100,y) for y in [115,210,305]],[(320,y) for y in [70,165,260,355]],[(540,y) for y in [165,260]]]
for left,right in zip(layers,layers[1:]):
    for a in left:
        for b in right:d.line((*a,*b),fill='#b7bcc7',width=2)
for layer in layers:
    for x,y in layer:d.ellipse((x-19,y-19,x+19,y+19),fill='#e0eafa',outline='#526b9c',width=2)
im.save(OUT/'network.png')
print('Prepared 5 reference categories: flowchart, curves, bars, geometry, network.')
