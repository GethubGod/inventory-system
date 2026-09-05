#!/usr/bin/env python3
"""Check the compiled Smelter app's essential offline launch resources."""
import argparse
import json
from pathlib import Path
import plistlib
import sys
import uuid


def verify(app: Path) -> None:
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info.get('CFBundleDisplayName') != 'Smelter':
        raise ValueError('Compiled display name is not Smelter')
    if info.get('CFBundleIdentifier') != 'com.babytuna.systems':
        raise ValueError('Unexpected compiled bundle identifier')
    bundle = app / 'main.jsbundle'
    if not bundle.is_file() or bundle.stat().st_size == 0:
        raise ValueError('Embedded JavaScript bundle is missing or empty')
    manifest = json.loads((app / 'EXUpdates.bundle/app.manifest').read_text())
    uuid.UUID(manifest['id'])
    if not isinstance(manifest.get('commitTime'), (int, float)) or manifest['commitTime'] <= 0:
        raise ValueError('Embedded update has no valid commit timestamp')
    assets = manifest.get('assets')
    if not isinstance(assets, list) or not assets:
        raise ValueError('Embedded update asset list is missing or empty')
    missing = []
    for asset in assets:
        path = app / asset.get('nsBundleDir', '') / f"{asset['nsBundleFilename']}.{asset['type']}"
        if not path.resolve().is_relative_to(app.resolve()) or not path.is_file():
            missing.append(str(path.relative_to(app)))
    if missing:
        raise ValueError('Missing embedded assets: ' + ', '.join(missing))
    print(f'PASS: Smelter identity, embedded JavaScript, valid update manifest and {len(assets)} bundled assets')
    print('This resource check does not validate signing, production services or App Store submission.')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path, help='Path to the compiled .app directory')
    args = parser.parse_args()
    try:
        verify(args.app)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
