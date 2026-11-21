#!/usr/bin/env python3
"""MOON WARS — update250: the Terra hangar for the fighter LIFT (jj 21.11: „animacja startu myśliwca — winda za kanał
i kil, spod statku na słupach").

    python3 tools/terra_v22/hangar_lift.py

hangar.py (update249) baked the lift into the room: the platform flush in the floor, its two posts folded. The lift
moves now, so the room is drawn WITHOUT them — the pit (its shaft, hazard-striped) lies in the floor where the
platform rests — and the moving parts are pictures of their own, drawn by the game (Ship._drawHangarLift):

  art/room_hangar_terra.png      800 x 200 (4 px a unit): the wall, the launch console, the fuel station, the pit
  art/lift_terra_platform.png    166 x 12 u: the platform (a piece of the floor)
  art/lift_terra_post1..3.png    the telescopic post's three sections, each 38 u long (6, 4.7, 3.2 u wide)
Uses src/parts/ written by hangar.py and the wall it starts from.
"""
import os, numpy as np
from PIL import Image
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(H, 'src', ''); ART = os.path.join(H, '..', '..', 'art', '')
U = 4
P = {k: Image.open(S + f'parts/{k}.png').convert('RGBA') for k in ('platform', 'pit', 'post1', 'post2', 'post3', 'console', 'fuel')}
def hard(im):
    q = np.array(im); q[..., 3] = np.where(q[..., 3] < 128, 0, 255); return Image.fromarray(q)
room = Image.new('RGBA', (200 * U, 50 * U)); room.alpha_composite(Image.open(S + 'room_hangar_wall_terra.png').convert('RGBA'))
c = P['console']; c = c.resize((round(c.width * 30 * U / c.height), 30 * U), Image.LANCZOS); room.alpha_composite(c, (2 * U, 38 * U - c.height))
f = P['fuel']; f = f.resize((round(f.width * 25 * U / f.height), 25 * U), Image.LANCZOS)
room.alpha_composite(f, (200 * U - f.width - 2 * U, 38 * U - f.height))
pit = P['pit'].resize((166 * U, 12 * U), Image.LANCZOS); room.alpha_composite(pit, (32 * U, 38 * U))
hard(room).save(ART + 'room_hangar_terra.png')
hard(P['platform'].resize((166 * U, 12 * U), Image.LANCZOS)).save(ART + 'lift_terra_platform.png')
for k, w in (('post1', 6), ('post2', 4.7), ('post3', 3.2)):
    hard(P[k].resize((round(w * U), 38 * U), Image.LANCZOS)).save(ART + f'lift_terra_{k}.png')
print('ok')
