"""Create standalone EP3D component lookup and lazy property shards.

Uses the same object/geometry mapping and transformed geometry bounds as
three-demo. Runtime output never needs the source project or its API.
"""
import argparse
import hashlib
import json
from pathlib import Path


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def build(properties_path, bounds_path, output):
    raw = properties_path.read_bytes()
    source = json.loads(raw.decode('utf-8-sig'))
    bounds = json.loads(bounds_path.read_text(encoding='utf-8-sig'))['boundsByGeometryId']
    by_unit = {}
    for obj in source['objects']:
        by_unit.setdefault(obj['unitName'], []).append(obj)
    manifest = {'version': 1, 'projectId': 'uae', 'signature': hashlib.sha256(raw).hexdigest(), 'units': {}}
    for unit, objects in by_unit.items():
        lines = list(dict.fromkeys(obj['lineName'] for obj in objects))
        line_ids = {line: i for i, line in enumerate(lines)}
        rows, shards = [], {}
        for i, obj in enumerate(objects):
            geometries = [gid for gid in obj['geometryIds'] if gid in bounds]
            merged = None
            if geometries:
                entries = [bounds[gid] for gid in geometries]
                merged = [*[min(entry['min'][axis] for entry in entries) for axis in range(3)],
                          *[max(entry['max'][axis] for entry in entries) for axis in range(3)]]
            values = dict(obj['properties'])
            diameter = next((values.get(k) for k, column in enumerate(source['columns']) if column['name'] == '公称直径'), '')
            shard = i // 1000
            rows.append([obj['id'], line_ids[obj['lineName']], obj['componentName'], obj.get('secondaryLabel', ''),
                         bool(obj.get('isWeld')), geometries, merged, shard, diameter])
            shards.setdefault(shard, {})[obj['id']] = obj['properties']
        for shard, data in shards.items():
            write(output / unit / f'properties-{shard}.json', data)
        payload = {'version': 1, 'unit': unit, 'columns': source['columns'], 'lines': lines, 'objects': rows}
        write(output / unit / 'index.json', payload)
        manifest['units'][unit] = {'url': f'/data/ep3d/{unit}/index.json', 'components': len(rows),
                                   'welds': sum(row[4] for row in rows),
                                   'locatableWelds': sum(bool(row[4] and row[6]) for row in rows)}
    write(output / 'manifest.json', manifest)
    print(json.dumps(manifest['units'], ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--properties', required=True, type=Path)
    parser.add_argument('--bounds', required=True, type=Path)
    parser.add_argument('--out', default=Path('public/data/ep3d'), type=Path)
    args = parser.parse_args()
    build(args.properties, args.bounds, args.out)
