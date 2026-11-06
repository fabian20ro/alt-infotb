"""Expand only pinned font/sprite assets; never create symlinks on disk."""
import pathlib
import posixpath
import stat
import sys
import zipfile

FONT_STACKS = ('Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic', 'Noto Sans Devanagari Regular v1')
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024


def extract(archive_path, output_path, commit):
    prefix = 'basemaps-assets-' + commit + '/'
    root = pathlib.Path(output_path)
    written = set()
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or len(names) > 10000:
            raise ValueError('Duplicate or excessive ZIP entries')

        def read_entry(item, seen):
            if item.filename in seen or len(seen) > 8:
                raise ValueError('Cyclic/deep ZIP symlink')
            if item.file_size > MAX_FILE:
                raise ValueError('Asset too large')
            content = archive.read(item)
            if not stat.S_ISLNK(item.external_attr >> 16):
                return content
            link = content.decode('utf8')
            if link.startswith('/') or '\\' in link:
                raise ValueError('Absolute/invalid ZIP symlink')
            target = posixpath.normpath(posixpath.join(posixpath.dirname(item.filename), link))
            if not target.startswith(prefix + 'fonts/'):
                raise ValueError('Unsafe ZIP symlink target')
            return read_entry(archive.getinfo(target), seen | {item.filename})

        for item in entries:
            if not item.filename.startswith(prefix) or item.is_dir():
                continue
            name = item.filename[len(prefix):]
            parts = pathlib.PurePosixPath(name).parts
            if name != pathlib.PurePosixPath(name).as_posix() or name.startswith('/') or '..' in parts or '\\' in name:
                raise ValueError('Unsafe ZIP path')
            selected = name == 'fonts/OFL.txt' or any(name.startswith('fonts/' + stack + '/') and name.endswith('.pbf') for stack in FONT_STACKS)
            selected = selected or name in ['sprites/v4/' + theme + suffix for theme in ('light', 'dark') for suffix in ('.json', '.png', '@2x.json', '@2x.png')]
            if not selected:
                continue
            destination = name.replace('sprites/v4/', 'sprites/')
            if destination in written:
                raise ValueError('Duplicate output path')
            content = read_entry(item, set())
            total += len(content)
            if total > MAX_TOTAL or len(written) >= 4096:
                raise ValueError('Extracted assets exceed limit')
            target = root.joinpath(*pathlib.PurePosixPath(destination).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            written.add(destination)


if __name__ == '__main__':
    extract(*sys.argv[1:])
