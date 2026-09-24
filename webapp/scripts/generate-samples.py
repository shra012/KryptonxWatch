#!/usr/bin/env python3
"""Generate synthetic, clearly labeled sample recordings with no external media."""
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
W,H,FPS,SECONDS=640,360,10,24
try: FONT=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",14)
except OSError: FONT=ImageFont.load_default()
try: SMALL=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",11)
except OSError: SMALL=ImageFont.load_default()

def person(draw,x,y,color):
    draw.ellipse((x-10,y-29,x+10,y-9),fill=color,outline="#dce8fb",width=2)
    draw.rounded_rectangle((x-13,y-8,x+13,y+28),radius=6,fill=color,outline="#dce8fb",width=2)
    draw.line((x-12,y+25,x-20,y+43),fill="#c5d3e8",width=5)
    draw.line((x+12,y+25,x+20,y+43),fill="#c5d3e8",width=5)

def frames(kind):
    for n in range(FPS*SECONDS):
        t=n/FPS
        im=Image.new("RGB",(W,H),"#112038")
        d=ImageDraw.Draw(im)
        d.rectangle((0,0,W,43),fill="#0b172b")
        d.text((18,14),"KRYPTONXWATCH  /  SYNTHETIC DEMO FOOTAGE",font=FONT,fill="#e5efff")
        d.text((520,15),f"{int(t//60):02d}:{int(t%60):02d}",font=FONT,fill="#b1c5df")
        for x in range(0,W,40): d.line((x,44,x,H),fill="#172a44",width=1)
        for y in range(44,H,40): d.line((0,y,W,y),fill="#172a44",width=1)
        if kind=="entrance":
            d.rounded_rectangle((30,80,156,295),radius=12,fill="#2b4563",outline="#6488a8",width=3)
            d.text((48,96),"ENTRANCE",font=SMALL,fill="#dce8fb")
            d.rectangle((77,133,112,243),outline="#99c1da",width=3)
            d.rounded_rectangle((475,85,606,145),radius=10,fill="#294866",outline="#597f9c",width=2)
            d.text((493,109),"SERVICE DESK",font=SMALL,fill="#dce8fb")
            person(d,260+45*math.sin(t*.3),213,"#388cbd")
            person(d,355+70*math.sin(t*.37+1),226,"#d39847")
            person(d,450+65*math.sin(t*.25+2),220,"#745fc1")
        else:
            for i,x in enumerate((90,280,470)):
                d.rounded_rectangle((x,105,x+105,161),radius=9,fill="#31506f",outline="#76a6b8",width=3)
                d.text((x+18,124),f"KIOSK {i+1}",font=SMALL,fill="#e0efff")
            person(d,180+35*math.sin(t*.32),225,"#498fbb")
            person(d,360+45*math.sin(t*.27+1),230,"#d79954")
            person(d,545+32*math.sin(t*.23+2),215,"#8063bc")
        d.rectangle((0,H-31,W,H),fill="#071426")
        d.text((17,H-23),"SIMULATED SCENE • NOT REAL DETECTION EVIDENCE",font=SMALL,fill="#d3e7ff")
        yield im.tobytes()

for kind,filename in (("entrance","market-entrance.webm"),("checkout","self-checkout.webm")):
    path=OUT/filename
    command=["ffmpeg","-y","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libvpx","-deadline","realtime","-cpu-used","5","-b:v","350k","-pix_fmt","yuv420p",str(path)]
    p=subprocess.Popen(command,stdin=subprocess.PIPE)
    assert p.stdin is not None
    for frame in frames(kind): p.stdin.write(frame)
    p.stdin.close()
    if p.wait()!=0: raise SystemExit(f"ffmpeg failed: {filename}")
    print(path, path.stat().st_size)
