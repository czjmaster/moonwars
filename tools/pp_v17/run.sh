#!/bin/sh
# MOON WARS — update249: Pegasus and Phoenix hulls from GPT v17 into the game (run from the repo root).
set -e
S=tools/pp_v17/src; W=${1:-/tmp/pp}
python3 tools/pp_v17/prep.py $S/plyty_pegasus.png $W enemy_frigate=$S/set.png isis=$S/isis.png enemy_hathor=$S/hathor.png
python3 tools/pp_v17/prep.py $S/plyty_phoenix.png $W enemy_gunship=$S/sobek.png enemy_raider=$S/anubis.png osiris=$S/osiris.png boss_station=$S/apophis.png
for k in enemy_frigate isis enemy_hathor enemy_gunship enemy_raider osiris; do
  python3 tools/fit_gpt_hull.py $k $W/${k}_A.png $W/${k}_B.png $W --stern 95 --bow 75
done
python3 tools/fit_gpt_hull.py boss_station $W/boss_station_A.png $W/boss_station_B.png $W
python3 tools/pp_v17/wells.py pegasus $S/podwozie_pegasus.png $W enemy_frigate isis enemy_hathor
python3 tools/pp_v17/wells.py phoenix $S/podwozie_phoenix.png $W enemy_gunship enemy_raider osiris
for k in enemy_frigate isis enemy_hathor enemy_gunship enemy_raider osiris boss_station; do
  python3 tools/gen_shaped_hull_art.py $k $W/${k}_hull_in.png $W/${k}_hull_out.png --fit $W/${k}_fit.json
done
python3 tools/pp_v17/spec.py $W enemy_frigate isis enemy_hathor enemy_gunship enemy_raider osiris boss_station
python3 tools/guns/find_rings.py --write     # Pegasus roofs: found; Phoenix ones (HAND in find_rings) stay as spec.py measured
# the carriers (update249): Geb (Terra, tools/terra_v21/src/geb.png, Terra's plates v7 and Terra's gear from art/), Tefnut, Sopdet
python3 tools/pp_v17/prep.py tools/terra_v21/src/plyty_terra_v7.png $W enemy_geb=tools/terra_v21/src/geb.png
python3 tools/pp_v17/prep.py $S/plyty_pegasus.png $W enemy_tefnut=$S/tefnut.png
python3 tools/pp_v17/prep.py $S/plyty_phoenix.png $W enemy_sopdet=$S/sopdet.png
for k in enemy_geb enemy_tefnut; do
  python3 tools/fit_gpt_hull.py $k $W/${k}_A.png $W/${k}_B.png $W --stern 95 --bow 75
done
python3 tools/fit_gpt_hull.py enemy_sopdet $W/enemy_sopdet_A.png $W/enemy_sopdet_B.png $W --stern 45 --bow 40   # 530 u of modules: the shortest ends (she stands opposite Isis)
python3 tools/pp_v17/wells.py terra art $W enemy_geb
python3 tools/pp_v17/wells.py pegasus $S/podwozie_pegasus.png $W enemy_tefnut
python3 tools/pp_v17/wells.py phoenix $S/podwozie_phoenix.png $W enemy_sopdet
for k in enemy_geb enemy_tefnut enemy_sopdet; do
  python3 tools/gen_shaped_hull_art.py $k $W/${k}_hull_in.png $W/${k}_hull_out.png --fit $W/${k}_fit.json
done
python3 tools/pp_v17/spec.py $W enemy_geb enemy_tefnut enemy_sopdet
python3 tools/guns/find_rings.py --write
