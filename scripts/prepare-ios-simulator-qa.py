#!/usr/bin/env python3
"""Disable automatic OTA checks only in a locally configured simulator artifact."""
import argparse
from pathlib import Path
import plistlib
import subprocess
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('app', type=Path)
parser.add_argument('--api-url', required=True, help='Exact loopback API URL used for this build')
args = parser.parse_args()
app = args.app.resolve()
info = plistlib.loads((app / 'Info.plist').read_bytes())
if info.get('CFBundleSupportedPlatforms') != ['iPhoneSimulator']:
    raise SystemExit('Refusing to modify an app that is not an iPhone simulator artifact.')
if info.get('CFBundleIdentifier') != 'com.babytuna.systems':
    raise SystemExit('Refusing to modify an unexpected app identity.')
endpoint = urlparse(args.api_url)
if endpoint.hostname not in ('127.0.0.1', 'localhost', '::1') or endpoint.port is None:
    raise SystemExit('QA API must be a loopback URL with an explicit port.')
bundle = (app / 'main.jsbundle').read_bytes()
if args.api_url.encode() not in bundle:
    raise SystemExit('Expected an app built with a local QA backend.')
expo = app / 'Expo.plist'
config = plistlib.loads(expo.read_bytes())
if not config.get('EXUpdatesEnabled'):
    raise SystemExit('Expected updates to remain enabled so the embedded manifest is exercised.')
config['EXUpdatesCheckOnLaunch'] = 'NEVER'
expo.write_bytes(plistlib.dumps(config))
subprocess.run(['codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', str(app)], check=True)
print('PASS: simulator-only OTA checks disabled; embedded updates remain enabled; local ad-hoc signature refreshed.')
print('Production source configuration is unchanged. Use an isolated simulator with no downloaded OTA cache.')
