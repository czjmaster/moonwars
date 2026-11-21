#!/usr/bin/env python3
"""MOON WARS — update249 (jj 21.11: „podoba mi się ta ściana, wiec na jej wzór zróbmy mniejsze ściany do modułów terra aby
pasowały lewa prawa"): the Terra module wall and the hangar wall from ONE continuous wall GPT drew, cut at its ribs.

    python3 tools/terra_v22/walls.py

src/walls_row_gpt.png — GPT's strips on src/g_walls_row.png (module | hangar | module; module ×3). GPT did not put its ribs on
the guide's ticks, so the wall is cut at the middles of ITS ribs (found by their amber light strips): every piece starts and
ends with half of the same rib and any piece stands next to any other. 4 px a unit, the wall 38 u (the ceiling beam and the
wall; GPT drew the strip ~20 % taller — squeezed). Writes:
  src/wall_mod_A.png, src/wall_mod_B.png (100 u), src/wall_hangar.png (200 u), 400 x 152 / 800 x 152;
  art/room_wall_terra.png = wall A over the deck of the update236 wall (its 38..50 u: the grating stays the same);
  src/room_hangar_wall_terra.png = the hangar wall over that deck twice (tools/terra_v22/hangar.py builds the room on it).
"""
import os
from PIL import Image
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(H, 'src', ''); ART = os.path.join(H, '..', '..', 'art', '')
src = Image.open(S + 'walls_row_gpt.png').convert('RGB')
Y0, Y1, U = 115, 286, 4                                   # the top strip, inside its outline
pieces = {'wall_mod_A': (22, 427, 100), 'wall_hangar': (427, 1138, 200), 'wall_mod_B': (1138, 1515, 100)}   # rib middles
out = {}
for k, (x0, x1, w) in pieces.items():
    out[k] = src.crop((x0, Y0, x1, Y1)).resize((w * U, 38 * U), Image.LANCZOS); out[k].save(S + k + '.png')
deck = Image.open(S + 'room_wall_terra_update236.png').convert('RGBA').crop((0, 38 * U, 100 * U, 50 * U))
m = Image.new('RGBA', (100 * U, 50 * U)); m.paste(out['wall_mod_A'], (0, 0)); m.alpha_composite(deck, (0, 38 * U)); m.save(ART + 'room_wall_terra.png')
h = Image.new('RGBA', (200 * U, 50 * U)); h.paste(out['wall_hangar'], (0, 0))
for x in (0, 100 * U): h.alpha_composite(deck, (x, 38 * U))
h.save(S + 'room_hangar_wall_terra.png')      # a step for hangar.py, not a sprite
print('ok', {k: v.size for k, v in out.items()})
