#!/usr/bin/env python3
"""MOON WARS — update249: the Terra HANGAR module's picture (200 x 50 u, 4 px a unit) from GPT's parts.

    python3 tools/terra_v22/hangar.py

  src/wall_hangar.png      the wall (tools/terra_v22/walls.py), its deck from the module wall
  src/hangar_eq_gpt.png    the machines on magenta (on src/g7b_hangar_equipment.png): the launch console, the fuel station —
                           cut out and stood at the very ENDS of the hangar (jj: „bardziej na boki … aby na środku było
                           wystarczająco miejsca na windę i myśliwiec")
  src/lift_gpt.png         the fighter lift (on src/g_lift_hangar.png): platform, pit, a telescopic post (3), its head
Writes art/room_hangar_terra.png (800 x 200): the wall, the machines, the lift's platform lying flush in the floor from
32 u to 198 u, its two posts folded, 20 u in from the platform's ends (jj: „trochę obok brzegów"), behind where the
fighter stands. The lift's parts for its run (later, with the fighters) go to src/parts/.
"""
import os, numpy as np
from PIL import Image
from scipy import ndimage as nd
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(H, 'src', ''); ART = os.path.join(H, '..', '..', 'art', '')
U = 4
def cut(im, box):
    c = im.crop(box).convert('RGBA'); a = np.array(c).astype(int)
    mag = np.abs(a[..., :3] - np.array((255, 0, 255))).sum(-1) < 150
    mag = nd.binary_dilation(mag, iterations=2) & (a[..., 0] > a[..., 1] + 25) & (a[..., 2] > a[..., 1] + 25) | mag
    a[mag, 3] = 0
    out = Image.fromarray(a.astype('uint8'), 'RGBA'); return out.crop(out.getbbox())
eq = Image.open(S + 'hangar_eq_gpt.png').convert('RGB')
console = cut(eq, (26, 300, 500, 666)); fuel = cut(eq, (900, 300, 1515, 666))
lift = Image.open(S + 'lift_gpt.png').convert('RGB')
parts = {'platform': cut(lift, (40, 45, 910, 155)), 'pit': cut(lift, (40, 180, 910, 305)),
         'post1': cut(lift, (50, 360, 150, 840)), 'post2': cut(lift, (200, 360, 280, 840)), 'post3': cut(lift, (330, 360, 390, 840)),
         'head': cut(lift, (430, 362, 565, 445))}
os.makedirs(S + 'parts', exist_ok=True)
for k, v in list(parts.items()) + [('console', console), ('fuel', fuel)]: v.save(S + f'parts/{k}.png')

room = Image.new('RGBA', (200 * U, 50 * U)); room.alpha_composite(Image.open(S + 'room_hangar_wall_terra.png').convert('RGBA'))
c = console.resize((round(console.width * 30 * U / console.height), 30 * U), Image.LANCZOS); room.alpha_composite(c, (2 * U, 38 * U - c.height))
f = fuel.resize((round(fuel.width * 25 * U / fuel.height), 25 * U), Image.LANCZOS)      # under the air lamps
room.alpha_composite(f, (200 * U - f.width - 2 * U, 38 * U - f.height))
pl = parts['platform'].resize((166 * U, 12 * U), Image.LANCZOS); room.alpha_composite(pl, (32 * U, 38 * U))
for x in (32 + 20, 198 - 20 - 6):                     # the folded posts, 6 u wide, from the ceiling to the platform
    p = parts['post1'].resize((6 * U, 38 * U), Image.LANCZOS); room.alpha_composite(p, (x * U, 0))
q = np.array(room); q[..., 3] = np.where(q[..., 3] < 128, 0, 255)
Image.fromarray(q).save(ART + 'room_hangar_terra.png')
print('ok', room.size, 'console', c.size, 'fuel', f.size)
