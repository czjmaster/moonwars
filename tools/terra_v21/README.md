# Terra v21 (update248, jj 21.11): Ptah, Sekhmet, Geb, płyty z hangarem

Źródła od GPT w `src/`. Ptah (`enemy_mech`) i Sekhmet (`bunker_small`) weszły do gry:

    python3 tools/terra_v18/prep.py tools/terra_v21/src/plyty_terra_v7.png /tmp/t enemy_mech=tools/terra_v21/src/ptah.png bunker_small=tools/terra_v21/src/sekhmet.png
    python3 tools/fit_gpt_hull.py enemy_mech /tmp/t/enemy_mech_A.png /tmp/t/enemy_mech_B.png /tmp/t
    python3 tools/gen_shaped_hull_art.py enemy_mech /tmp/t/enemy_mech_hull_in.png /tmp/t/enemy_mech_hull_out.png --fit /tmp/t/enemy_mech_fit.json
    (to samo dla bunker_small)  ->  ręcznie `sockets: true` po `flames`,  python3 tools/guns/find_rings.py --write
    (Ptah: pierścień ręcznie, [356, 418, 16] — dach obok to obudowa, find_rings go nie widzi)
    python3 tools/optimize_art.py  -> cofnąć wszystko poza hull_enemy_mech*/hull_bunker_small* (git checkout)

Geb (lotniskowiec Terry, układ = Albatros z jednym hangarem, `tools/blueprint_v2.py carrier:geb:Geb`) czeka na moduł hangaru
(200 u) — bez mechaniki myśliwców. `plyty_terra_v7.png` ma płytę hangaru (59,380 800x278).
