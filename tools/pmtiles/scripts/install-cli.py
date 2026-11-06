#!/usr/bin/env python3
"""Install a checksum-pinned official CLI; never execute an unverified download."""
import hashlib
import io
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import zipfile

VERSION = '1.31.2'
# Official release asset digests, verified 2026-11-07:
# https://api.github.com/repos/protomaps/go-pmtiles/releases/tags/v1.31.2
ASSETS = {
    ('Linux', 'x86_64'): ('go-pmtiles_1.31.2_Linux_x86_64.tar.gz', '3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f'),
    ('Linux', 'aarch64'): ('go-pmtiles_1.31.2_Linux_arm64.tar.gz', 'f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1'),
    ('Darwin', 'arm64'): ('go-pmtiles-1.31.2_Darwin_arm64.zip', '40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d'),
    ('Darwin', 'x86_64'): ('go-pmtiles-1.31.2_Darwin_x86_64.zip', '1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b'),
}

def main():
    asset = ASSETS.get((platform.system(), platform.machine()))
    if not asset:
        raise RuntimeError('Supported platforms: macOS/Linux, ARM64/x86_64')
    name, digest = asset
    destination = Path(sys.argv[1] if len(sys.argv) > 1 else '.bin/pmtiles').resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pmtiles-cli-') as temporary:
        archive = Path(temporary) / name
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                        '--proto', '=https', '--proto-redir', '=https', '--max-time', '180',
                        '--max-filesize', '104857600',
                        f'https://github.com/protomaps/go-pmtiles/releases/download/v{VERSION}/{name}',
                        '--output', str(archive)], check=True)
        content = archive.read_bytes()
        if hashlib.sha256(content).hexdigest() != digest:
            raise RuntimeError('Official CLI archive SHA256 mismatch')
        if name.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(content)) as package:
                binary = package.read('pmtiles')
        else:
            with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as package:
                member = package.getmember('pmtiles')
                if not member.isfile():
                    raise RuntimeError('CLI release binary must be a regular file')
                binary = package.extractfile(member).read()
        # Write only the expected binary. No archive paths are extracted to disk.
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as candidate:
            candidate_path = Path(candidate.name)
            candidate.write(binary)
        try:
            candidate_path.chmod(0o755)
            version = subprocess.check_output([str(candidate_path), 'version'], text=True)
            if not version.startswith(f'pmtiles {VERSION},'):
                raise RuntimeError('Installed CLI version mismatch')
            os.replace(candidate_path, destination)
        finally:
            candidate_path.unlink(missing_ok=True)
    print(f'Installed pmtiles {VERSION}: {destination}')

if __name__ == '__main__':
    main()
