"""Exports the desktop app's calibration labels for the extension's calibration page.

Usage: python -I export-calibration-labels.py OUTPUT.json

Reads %LOCALAPPDATA%\\PhotoCleaner\\analysis.db read-only and writes only the labelled pairs: the
two photos' media keys and the label (SAME, NEAR_DUPLICATE or DIFFERENT). No images, no scores.
The file names photos of your library, so keep it on this computer.
"""

import json
import os
import sqlite3
import sys

if len(sys.argv) != 2:
    sys.exit(__doc__)

database = os.path.join(os.environ['LOCALAPPDATA'], 'PhotoCleaner', 'analysis.db')
connection = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
rows = connection.execute(
    'SELECT media_key_a, media_key_b, label FROM calibration_pair WHERE label IS NOT NULL ORDER BY display_order'
).fetchall()
with open(sys.argv[1], 'w', encoding='utf-8') as out:
    json.dump({'pairs': [{'a': a, 'b': b, 'label': label} for a, b, label in rows]}, out, indent=1)
print(f'{len(rows)} labelled pairs written to {sys.argv[1]}')
